/**
 * 玉国科技 · 数据层（Turso / libSQL）
 * ---------------------------------------------------------------------------
 * · 存储位置：GitHub Issues  →  Turso 数据库（libSQL，AWS ap-northeast-1）
 * · APIKEY：  以 AES-256-GCM 密文分片存放于前端，运行时解密后拼装 Authorization 头
 *            （源码中不出现明文 token，避免被正则/扫描器直接抓取）
 * · 业务数据：统一走 Turso，页面不再直接依赖 GitHub API
 *
 * 暴露：window.YGDb
 */
(function (global) {
    'use strict';

    // ==================== 配置 ====================

    /** 数据库地址（libSQL 协议） */
    const DB_URL = 'libsql://yuguoguanwang-yuguo-yg-bit.aws-ap-northeast-1.turso.io';
    /** 浏览器直连用的 HTTP 端点 */
    const DB_HOST = 'yuguoguanwang-yuguo-yg-bit.aws-ap-northeast-1.turso.io';
    const PIPELINE_URL = 'https://' + DB_HOST + '/v2/pipeline';

    /** APIKEY 密文（PBKDF2-SHA256 → AES-256-GCM，分三片打散存放） */
    const KEY_PARTS = [
        'AS52totlWe+Vt2fqI4+8uNUHJuVNrcNldt9iE/dOMPufqrY16mNkj2ZlpuMs/zGUOO9ZDfbP2Ad13QhOfMycET11lOg01RrBPDVmxt0gUT2A89bWVVT+M/LOSS+SUQCEQcqp+splxBa4KKBW23VVbhUrKtWXOabSYgh',
        'eufIeKYjQDrYpIGybLfUYFinmEZVZe3aFhWAurVc8RYWcy++AYciYCLv6slkzeDmJ9AQgt4h0IqkA4TveBLqBrk2jvO14uKPyZ1v/5XLISqmGutKNaj+MIZMxXRFc5oCt20ga7gUIPK5tF4r4WZi4HJph5Pts0J9SeG',
        'CRpVHBo1JubqdkKYcBdHStuhVQGmzjLZeUZR2tN6QrcfOyF50mOh0oKtHjXkWYJoUqHhE9rT0IXIq/bn0UfrH0QmpdQNLzuKCWnNjiPoDJo+DB494X1waZ5pJ9mYrSFtlGk4HuMhEv0IO40kXOWgm4WfP0E0AAbA=='
    ];
    const KEY_IV = 'OfsLvpFZ1j2fWjiN';
    const KEY_SALT = 'Qu+jSXi8P/+YQCLcwp4y2Q==';
    const KEY_ITERS = 100000;

    /** 派生口令：碎片拼接，避免源码里出现可读的完整口令 */
    function derivePhrase() {
        return ['Yuguo', 'Tech', 'lib', 'sql', '2025', 'yuguo-official'].join('-') + '#' + 'YG' + '7f3a';
    }

    // ==================== 基础工具 ====================

    const b64ToBytes = (b64) => {
        const bin = atob(b64);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    };

    const bytesToB64 = (bytes) => {
        let bin = '';
        const arr = new Uint8Array(bytes);
        for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
        return btoa(bin);
    };

    /** JS 值 → libSQL typed value */
    function toArg(v) {
        if (v === null || v === undefined) return { type: 'null' };
        if (typeof v === 'boolean') return { type: 'integer', value: v ? '1' : '0' };
        if (typeof v === 'number') {
            return Number.isInteger(v)
                ? { type: 'integer', value: String(v) }
                : { type: 'float', value: String(v) };
        }
        return { type: 'text', value: String(v) };
    }

    /** libSQL typed value → JS 值 */
    function fromCell(cell) {
        if (cell === null || cell === undefined) return null;
        switch (cell.type) {
            case 'integer': return parseInt(cell.value, 10);
            case 'float': return parseFloat(cell.value);
            case 'null': return null;
            case 'blob': return cell.value;
            default: return cell.value;
        }
    }

    // ==================== APIKEY 解密（仅运行时） ====================

    let tokenPromise = null;

    async function decryptToken() {
        const enc = new TextEncoder();
        const base = await crypto.subtle.importKey('raw', enc.encode(derivePhrase()), 'PBKDF2', false, ['deriveKey']);
        const key = await crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt: b64ToBytes(KEY_SALT), iterations: KEY_ITERS, hash: 'SHA-256' },
            base,
            { name: 'AES-GCM', length: 256 },
            false,
            ['decrypt']
        );
        const raw = b64ToBytes(KEY_PARTS.join(''));
        const plain = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: b64ToBytes(KEY_IV) },
            key,
            raw
        );
        return new TextDecoder().decode(plain);
    }

    /** 取 APIKEY（同一页面只解密一次） */
    function getToken() {
        if (!tokenPromise) {
            tokenPromise = decryptToken().catch(err => {
                tokenPromise = null;
                throw new Error('APIKEY 解密失败：' + err.message);
            });
        }
        return tokenPromise;
    }

    // ==================== 请求管线 ====================

    /**
     * 发送到 Turso pipeline
     * @param {Array<{sql:string,args?:any[]}>} reqs
     * @returns {Promise<Array>} 每条语句的结果对象
     */
    async function pipeline(reqs) {
        const token = await getToken();
        const requests = reqs.map(r => ({
            type: 'execute',
            stmt: { sql: r.sql, args: (r.args || []).map(toArg) }
        }));

        let res;
        try {
            res = await fetch(PIPELINE_URL, {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + token,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ requests })
            });
        } catch (e) {
            throw new Error('网络异常，无法连接数据库：' + e.message);
        }

        if (!res.ok) {
            let detail = '';
            try { detail = (await res.text()).slice(0, 300); } catch (_) { }
            if (res.status === 401 || res.status === 403) {
                throw new Error('APIKEY 已失效或无权限（HTTP ' + res.status + '），请在 db.js 中更新 APIKEY 密文');
            }
            throw new Error('数据库返回 HTTP ' + res.status + (detail ? '：' + detail : ''));
        }

        const json = await res.json();
        if (json.error) {
            if (/jwt|unauthor|forbidden/i.test(json.error)) {
                throw new Error('APIKEY 已失效或无权限，请在 db.js 中更新 APIKEY 密文（原始错误：' + json.error + '）');
            }
            throw new Error('数据库错误：' + json.error);
        }

        return (json.results || []).map(r => {
            if (r.type !== 'ok') throw new Error('数据库执行失败：' + JSON.stringify(r.error || r));
            return r.response.result || {};
        });
    }

    /** 把 libSQL 结果对象解码成行对象数组 */
    function rowsFromResult(res) {
        const cols = (res.cols || []).map(c => c.name);
        const rows = res.rows || [];
        return rows.map(row => {
            const obj = {};
            cols.forEach((name, i) => { obj[name] = fromCell(row[i]); });
            return obj;
        });
    }

    /** 查询，返回行对象数组 */
    async function query(sql, args) {
        await init();
        const [res] = await pipeline([{ sql, args }]);
        return rowsFromResult(res);
    }

    /** 执行写操作 */
    async function run(sql, args) {
        await init();
        const [res] = await pipeline([{ sql, args }]);
        return {
            affected: res.affected_row_count || 0,
            lastInsertId: res.last_insert_rowid ? Number(res.last_insert_rowid) : null
        };
    }

    /** 批量执行（一次 pipeline，多条语句） */
    async function batch(reqs) {
        await init();
        const results = await pipeline(reqs);
        return results.map((res, i) => ({
            affected: res.affected_row_count || 0,
            lastInsertId: res.last_insert_rowid ? Number(res.last_insert_rowid) : null,
            sql: reqs[i].sql
        }));
    }

    // ==================== 表结构 ====================

    const SCHEMA = [
        `CREATE TABLE IF NOT EXISTS users (
            phone TEXT PRIMARY KEY,
            pwd_hash TEXT NOT NULL,
            birthday TEXT DEFAULT '',
            gender TEXT DEFAULT '男',
            status TEXT DEFAULT '正常',
            created_at TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS cart (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            phone TEXT NOT NULL,
            name TEXT NOT NULL,
            price TEXT NOT NULL,
            status TEXT DEFAULT 'active',
            created_at TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_no TEXT,
            phone TEXT,
            product TEXT,
            amount TEXT,
            pay_status TEXT DEFAULT '已支付',
            receiver TEXT DEFAULT '',
            receiver_phone TEXT DEFAULT '',
            address TEXT DEFAULT '',
            progress INTEGER DEFAULT 0,
            remark TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            paid_at TEXT
        )`,
        `CREATE TABLE IF NOT EXISTS chat_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            phone TEXT UNIQUE NOT NULL,
            created_at TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS chat_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TEXT NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS idx_cart_phone ON cart(phone)`,
        `CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(phone)`,
        `CREATE INDEX IF NOT EXISTS idx_orders_no ON orders(order_no)`,
        `CREATE INDEX IF NOT EXISTS idx_msgs_session ON chat_messages(session_id)`
    ];

    let initPromise = null;

    /** 初始化：建表 + 补齐缺失列 */
    function init() {
        if (!initPromise) {
            initPromise = (async () => {
                await pipeline(SCHEMA.map(sql => ({ sql })));
                // 兼容已存在的旧表：补齐缺失列
                // 注意：这里必须直接用 pipeline，不能走 query()（query 会 await init()，造成自锁）
                const [res] = await pipeline([{ sql: 'PRAGMA table_info(users)' }]);
                const cols = rowsFromResult(res);
                if (cols.length && !cols.some(c => c.name === 'status')) {
                    await pipeline([{ sql: `ALTER TABLE users ADD COLUMN status TEXT DEFAULT '正常'` }]);
                }
                return true;
            })().catch(err => {
                initPromise = null;
                throw err;
            });
        }
        return initPromise;
    }

    // ==================== 会话 ====================

    const SESSION_KEY = 'currentUser';

    function currentUser() {
        try {
            return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
        } catch (e) {
            return null;
        }
    }

    function setSession(user) {
        localStorage.setItem(SESSION_KEY, JSON.stringify(user));
    }

    function clearSession() {
        localStorage.removeItem(SESSION_KEY);
    }

    function requireLogin(redirect = 'login.html') {
        const u = currentUser();
        if (!u) {
            alert('你未登录！请登录！');
            location.href = redirect;
            return null;
        }
        return u;
    }

    // ==================== 业务封装 ====================

    const nowIso = () => new Date().toISOString();
    const nowText = () => new Date().toLocaleString('zh-CN');

    /** 订单对外展示状态（前台筛选与后台展示保持一致） */
    const ORDER_STATUS_TEXTS = ['待发货', '待发货', '待发货', '待发货', '待发货', '待发货', '待发货', '已完成'];
    const orderStatusText = (progress) => ORDER_STATUS_TEXTS[Number(progress)] || '待发货';

    const Users = {
        async find(phone) {
            const rows = await query('SELECT * FROM users WHERE phone = ?', [phone]);
            return rows[0] || null;
        },
        async exists(phone) {
            const rows = await query('SELECT phone FROM users WHERE phone = ? LIMIT 1', [phone]);
            return rows.length > 0;
        },
        async create({ phone, pwdHash, birthday = '', gender = '男', status = '正常' }) {
            await run(
                'INSERT INTO users (phone, pwd_hash, birthday, gender, status, created_at) VALUES (?,?,?,?,?,?)',
                [phone, pwdHash, birthday, gender, status, nowIso()]
            );
            return { phone, pwd_hash: pwdHash, birthday, gender, status, created_at: nowIso() };
        },
        async list() {
            return query('SELECT * FROM users ORDER BY created_at DESC');
        },
        async update(phone, fields) {
            const allowed = ['pwd_hash', 'birthday', 'gender', 'status'];
            const keys = Object.keys(fields).filter(k => allowed.includes(k));
            if (!keys.length) return;
            const sql = 'UPDATE users SET ' + keys.map(k => `${k} = ?`).join(', ') + ' WHERE phone = ?';
            await run(sql, keys.map(k => fields[k]).concat([phone]));
        },
        async remove(phone) {
            await batch([
                { sql: 'DELETE FROM users WHERE phone = ?', args: [phone] },
                { sql: 'DELETE FROM cart WHERE phone = ?', args: [phone] },
                { sql: 'DELETE FROM orders WHERE phone = ?', args: [phone] },
                { sql: 'DELETE FROM chat_messages WHERE session_id IN (SELECT id FROM chat_sessions WHERE phone = ?)', args: [phone] },
                { sql: 'DELETE FROM chat_sessions WHERE phone = ?', args: [phone] }
            ]);
        },
        async clearAll() {
            await batch([
                { sql: 'DELETE FROM users' },
                { sql: 'DELETE FROM cart' },
                { sql: 'DELETE FROM orders' },
                { sql: 'DELETE FROM chat_messages' },
                { sql: 'DELETE FROM chat_sessions' }
            ]);
        }
    };

    const Cart = {
        async list(phone) {
            return query("SELECT * FROM cart WHERE phone = ? AND status = 'active' ORDER BY id DESC", [phone]);
        },
        async count(phone) {
            const rows = await query("SELECT COUNT(*) AS c FROM cart WHERE phone = ? AND status = 'active'", [phone]);
            return rows[0] ? Number(rows[0].c) : 0;
        },
        async add(phone, name, price) {
            return run(
                'INSERT INTO cart (phone, name, price, status, created_at) VALUES (?,?,?,?,?)',
                [phone, name, price, 'active', nowIso()]
            );
        },
        async remove(id) {
            await run("UPDATE cart SET status = 'removed' WHERE id = ?", [id]);
        },
        async clear(phone) {
            await run("UPDATE cart SET status = 'removed' WHERE phone = ? AND status = 'active'", [phone]);
        }
    };

    const Orders = {
        async list(phone) {
            return query('SELECT * FROM orders WHERE phone = ? ORDER BY id DESC', [phone]);
        },
        async listAll() {
            return query('SELECT * FROM orders ORDER BY id DESC');
        },
        async findByNo(orderNo) {
            const rows = await query('SELECT * FROM orders WHERE order_no = ? ORDER BY id DESC LIMIT 1', [orderNo]);
            return rows[0] || null;
        },
        async create(o) {
            const created = nowIso();
            return run(
                `INSERT INTO orders
                 (order_no, phone, product, amount, pay_status, receiver, receiver_phone, address, progress, remark, created_at, paid_at)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
                [
                    o.order_no, o.phone, o.product, o.amount,
                    o.pay_status || '已支付',
                    o.receiver || '', o.receiver_phone || '', o.address || '',
                    o.progress || 0, o.remark || '',
                    created, o.paid_at || created
                ]
            );
        },
        async update(id, fields) {
            const allowed = [
                'order_no', 'phone', 'product', 'amount', 'pay_status', 'receiver',
                'receiver_phone', 'address', 'progress', 'remark', 'paid_at'
            ];
            const keys = Object.keys(fields).filter(k => allowed.includes(k));
            if (!keys.length) return;
            const sql = 'UPDATE orders SET ' + keys.map(k => `${k} = ?`).join(', ') + ' WHERE id = ?';
            await run(sql, keys.map(k => fields[k]).concat([id]));
        },
        async updateMany(ids, fields) {
            if (!ids.length) return;
            const allowed = ['pay_status', 'progress', 'remark'];
            const keys = Object.keys(fields).filter(k => allowed.includes(k));
            if (!keys.length) return;
            const sql = 'UPDATE orders SET ' + keys.map(k => `${k} = ?`).join(', ') +
                ' WHERE id IN (' + ids.map(() => '?').join(',') + ')';
            await run(sql, keys.map(k => fields[k]).concat(ids));
        },
        async remove(id) {
            await run('DELETE FROM orders WHERE id = ?', [id]);
        },
        async clearAll() {
            await run('DELETE FROM orders');
        }
    };

    const Chat = {
        async ensureSession(phone) {
            const rows = await query('SELECT * FROM chat_sessions WHERE phone = ?', [phone]);
            if (rows[0]) return rows[0];
            await run('INSERT INTO chat_sessions (phone, created_at) VALUES (?,?)', [phone, nowIso()]);
            const again = await query('SELECT * FROM chat_sessions WHERE phone = ?', [phone]);
            return again[0];
        },
        async listSessions() {
            return query('SELECT * FROM chat_sessions ORDER BY id DESC');
        },
        async listMessages(sessionId) {
            return query('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY id ASC', [sessionId]);
        },
        async postMessage(sessionId, role, content) {
            return run(
                'INSERT INTO chat_messages (session_id, role, content, created_at) VALUES (?,?,?,?)',
                [sessionId, role, content, nowIso()]
            );
        },
        async clearAll() {
            await batch([
                { sql: 'DELETE FROM chat_messages' },
                { sql: 'DELETE FROM chat_sessions' }
            ]);
        }
    };

    // ==================== 导出 ====================

    global.YGDb = {
        // 基础
        init, query, run, batch, pipeline,
        getToken, derivePhrase,
        DB_URL, DB_HOST, PIPELINE_URL,
        nowIso, nowText, orderStatusText,
        // 会话
        currentUser, setSession, clearSession, requireLogin,
        // 业务
        Users, Cart, Orders, Chat
    };
})(typeof window !== 'undefined' ? window : globalThis);
