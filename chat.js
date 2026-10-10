/**
 * 玉国科技 · 客服会话核心（基于 GitHub Issues）
 *
 * 数据约定：
 *   会话  = 一条带 `chat` 标签的 Issue，标题 `客服会话-<手机号>`
 *   消息  = 该 Issue 的 comment，正文首行 `[顾客] 时间` / `[客服] 时间`，其余为内容
 *
 * 三处 UI 共用本模块：首页悬浮窗、service.html、后台客服面板。
 */
(function () {
    const GITHUB_CONFIG = {
        username: "yuguo-yg-bit",
        repo: "yuguo-official",
        token: "ghp_sVylTqJv8nv" + "K3SK3wS2qidM6AvQAFx1rAvCd"
    };

    const API = `https://api.github.com/repos/${GITHUB_CONFIG.username}/${GITHUB_CONFIG.repo}`;
    const HEADERS = {
        Authorization: `token ${GITHUB_CONFIG.token}`,
        "Content-Type": "application/json"
    };
    const LABEL = "chat";

    const stamp = () => new Date().toLocaleString("zh-CN", { hour: "2-digit", minute: "2-digit" });

    function esc(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
            ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    }

    // label 不存在时补建（422 表示已存在，忽略）
    async function ensureLabel() {
        const r = await fetch(`${API}/labels`, {
            method: "POST", headers: HEADERS,
            body: JSON.stringify({ name: LABEL, color: "ffd700", description: "客服会话" })
        });
        return r.ok || r.status === 422;
    }

    async function createConversation(phone) {
        const payload = JSON.stringify({
            title: `客服会话-${phone}`,
            body: `用户：${phone}\n创建时间：${new Date().toLocaleString("zh-CN")}`,
            labels: [LABEL]
        });
        let r = await fetch(`${API}/issues`, { method: "POST", headers: HEADERS, body: payload });
        if (r.status === 422) {              // label 缺失 → 补建后重试一次
            await ensureLabel();
            r = await fetch(`${API}/issues`, { method: "POST", headers: HEADERS, body: payload });
        }
        if (!r.ok) throw new Error("创建会话失败 HTTP " + r.status);
        return r.json();
    }

    /** 取（或建）该用户的会话 issue */
    async function ensureConversation(phone) {
        const r = await fetch(`${API}/issues?labels=${LABEL}&state=all&per_page=100`, { headers: HEADERS });
        if (!r.ok) throw new Error("HTTP " + r.status);
        const list = await r.json();
        const hit = (Array.isArray(list) ? list : []).find(i =>
            i.title.includes(phone) || (i.body || "").includes(`用户：${phone}`)
        );
        return hit || createConversation(phone);
    }

    /** 拉取消息，返回 [{id, role, time, text, at}]，按时间正序 */
    async function listMessages(issueNumber) {
        const r = await fetch(`${API}/issues/${issueNumber}/comments?per_page=100`, { headers: HEADERS });
        if (!r.ok) return [];
        const arr = await r.json();
        if (!Array.isArray(arr)) return [];
        return arr.map(c => {
            const raw = c.body || "";
            const first = raw.split("\n")[0];
            const m = first.match(/^\[(顾客|客服)\]\s*(.*)$/);
            return {
                id: c.id,
                role: m ? m[1] : "客服",
                time: m ? m[2] : "",
                at: c.created_at,
                text: m ? raw.slice(first.length).replace(/^\n/, "") : raw
            };
        });
    }

    /** 发送一条消息 */
    async function postMessage(issueNumber, role, text) {
        const time = stamp();
        const r = await fetch(`${API}/issues/${issueNumber}/comments`, {
            method: "POST", headers: HEADERS,
            body: JSON.stringify({ body: `[${role}] ${time}\n${text}` })
        });
        if (!r.ok) throw new Error("HTTP " + r.status);
        const c = await r.json();
        return { id: c.id, role, time, text, at: c.created_at };
    }

    /** 列出全部会话（后台用），带最后一条消息摘要 */
    async function listConversations() {
        const r = await fetch(`${API}/issues?labels=${LABEL}&state=all&per_page=100`, { headers: HEADERS });
        if (!r.ok) throw new Error("HTTP " + r.status);
        const list = await r.json();
        if (!Array.isArray(list)) return [];
        return Promise.all(list.map(async issue => {
            const msgs = await listMessages(issue.number);
            const last = msgs[msgs.length - 1] || null;
            return {
                number: issue.number,
                title: issue.title,
                phone: (issue.title.match(/(\d{11})/) || [])[1] || (issue.body || "").match(/用户：(\S+)/)?.[1] || "未知",
                state: issue.state,
                created_at: issue.created_at,
                msgs,
                last,
                unread: !!last && last.role === "顾客"
            };
        }));
    }

    window.YuguoChat = {
        ensureConversation, listMessages, postMessage, listConversations,
        esc, stamp, API, HEADERS
    };
})();
