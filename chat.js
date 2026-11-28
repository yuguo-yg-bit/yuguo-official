/**
 * 玉国科技 · 客服会话核心（基于 Turso / libSQL）
 *
 * 数据约定：
 *   会话  = chat_sessions 表里该手机号的一条记录（phone 唯一）
 *   消息  = chat_messages 表里 session_id 指向该会话的记录
 *
 * 对外接口与旧版（GitHub Issues）保持一致，首页悬浮窗、service.html、后台客服面板共用本模块。
 */
(function () {
    const DB = window.YGDb;

    const stamp = () => new Date().toLocaleString("zh-CN", { hour: "2-digit", minute: "2-digit" });

    function esc(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
            ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    }

    /** 取（或建）该用户的会话 */
    async function ensureConversation(phone) {
        const session = await DB.Chat.ensureSession(phone);
        return {
            number: session.id,
            id: session.id,
            phone: session.phone,
            created_at: session.created_at,
            state: 'open'
        };
    }

    /** 拉取消息，返回 [{id, role, time, text, at}]，按时间正序 */
    async function listMessages(sessionId) {
        if (!sessionId) return [];
        const rows = await DB.Chat.listMessages(sessionId);
        return rows.map(m => ({
            id: m.id,
            role: m.role,
            time: new Date(m.created_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
            text: m.content,
            at: m.created_at
        }));
    }

    /** 发送一条消息 */
    async function postMessage(sessionId, role, text) {
        await DB.Chat.postMessage(sessionId, role, text);
        return { id: Date.now(), role, time: stamp(), text, at: new Date().toISOString() };
    }

    /** 列出全部会话（后台用），带最后一条消息摘要 */
    async function listConversations() {
        const sessions = await DB.Chat.listSessions();
        const out = [];
        for (const s of sessions) {
            const msgs = await DB.Chat.listMessages(s.id);
            const last = msgs.length ? msgs[msgs.length - 1] : null;
            out.push({
                number: s.id,
                title: `客服会话-${s.phone}`,
                phone: s.phone,
                state: 'open',
                created_at: s.created_at,
                msgs: msgs.map(m => ({
                    id: m.id,
                    role: m.role,
                    time: new Date(m.created_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
                    text: m.content,
                    at: m.created_at
                })),
                last: last ? {
                    id: last.id,
                    role: last.role,
                    time: new Date(last.created_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
                    text: last.content,
                    at: last.created_at
                } : null,
                unread: !!last && last.role === "顾客"
            });
        }
        return out;
    }

    window.YuguoChat = {
        ensureConversation, listMessages, postMessage, listConversations,
        esc, stamp
    };
})();
