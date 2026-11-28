# yuguo-official

玉国专用 · 玉国科技官网（静态站）

> 数据存储：**Turso / libSQL**（`libsql://yuguoguanwang-yuguo-yg-bit.aws-ap-northeast-1.turso.io`）
> 所有业务数据（用户 / 购物车 / 订单 / 客服会话）全部走 Turso，**不再使用 GitHub Issues 存储**。

---

## 一、本次改造要点

| 改造前 | 改造后 |
| --- | --- |
| GitHub Issues 当数据库（label 区分业务） | Turso / libSQL 真实数据库（5 张表） |
| GitHub Token 明文硬编码在前端（已泄露） | **APIKEY 以 AES-256-GCM 密文分片存放**，运行时解密使用 |
| 登录靠「拉全表 + 正则扫 body」匹配 | `WHERE phone = ?` 参数化精确查询 |
| 后台删除走 GraphQL 删 Issue | `DELETE` / `UPDATE` 直接操作数据库 |
| 客服会话 = Issue + comments | `chat_sessions` + `chat_messages` 两张表 |

### 已改动的文件

| 文件 | 说明 |
| --- | --- |
| `db.js` | **新增**。Turso 客户端 + APIKEY 解密 + 建表 + 全部业务封装（Users / Cart / Orders / Chat） |
| `chat.js` | 重写为走 Turso，对外接口（`ensureConversation` / `listMessages` / `postMessage` / `listConversations`）保持不变，首页 / 客服页 / 后台三处共用 |
| `register.html` | 注册写入 `users` 表；手机号重复即拒绝 |
| `login.html` | 登录改为按手机号查库 + 校验密码哈希 |
| `index.html` | 购物车角数、加入购物车、生日信息、我的订单、客服悬浮窗全部改库 |
| `cart.html` | 购物车列表 / 删除 / 下单（生成订单 + 清空购物车）改库 |
| `pay-record.html` | 购买记录列表 + 状态筛选改库 |
| `logistics.html` | 物流页按订单号查库渲染 |
| `danzai.html` | 下单（3D 打印蛋仔）写入 `orders` 表 |
| `service.html` | 客服页会话 + 订单查询改库 |
| `AdMiN_AdMiN.html` | 后台数据层全量改库：订单 / 用户 / 客服会话的增删改查、批量操作、CSV 导出、清空数据 |
| `tools.html` | 删除无用的 GitHub Token 死代码 |

---

## 二、数据表

首次访问任意页面时由 `db.js` 自动建表（幂等，兼容已存在的旧表）。

| 表 | 字段 | 用途 |
| --- | --- | --- |
| `users` | phone(主键) / pwd_hash / birthday / gender / status / created_at | 用户 |
| `cart` | id / phone / name / price / status / created_at | 购物车（`status='removed'` 为软删除） |
| `orders` | id / order_no / phone / product / amount / pay_status / receiver / receiver_phone / address / progress / remark / created_at / paid_at | 订单 |
| `chat_sessions` | id / phone(唯一) / created_at | 客服会话 |
| `chat_messages` | id / session_id / role / content / created_at | 客服消息 |

> 旧数据未迁移（按需求：全部用新数据）。Turso 库在本次改造前为空表。

---

## 三、APIKEY 加密说明

前端直连 Turso 必须携带 APIKEY，源码里**不出现明文 token**：

1. `db.js` 里只存 **AES-256-GCM 密文**（拆成 3 段 base64 打散存放）＋ IV ＋ salt；
2. 密钥由 `PBKDF2-SHA256(派生口令, salt, 100000 次)` 派生，派生口令由 6 个碎片拼接而成；
3. 运行时用 Web Crypto 解密出 token，缓存于内存（不落 localStorage），拼装 `Authorization: Bearer ...` 头。

### 什么时候需要手动更新 APIKEY

Turso 轮换签名密钥或你重置 token 后，前端会拿到 401。此时页面会提示
「APIKEY 已失效或无权限」，需要重新生成密文并替换 `db.js` 顶部的 `KEY_PARTS` / `KEY_IV` / `KEY_SALT`。

> 生成器放在仓库外（不提交），避免与密文同处一地。思路：
> `PBKDF2 → AES-256-GCM 加密 token → 密文 base64 → 切成 3 段`，改密文时同样三段拼回。

### 安全边界（务必知悉）

静态站直连数据库 = **谁拿到前端代码，谁就能拿到 APIKEY**。本次改造达成的是：

- 数据库本身只存业务明文字段，但**没有 GitHub token 泄露风险**，也不依赖 GitHub API 配额；
- APIKEY 不再以明文形式出现在 HTML / JS 里，避免被扫描器或正则直接抓取；
- 如果需要更严格的隔离，唯一办法是加一层服务端代理（把 APIKEY 放在服务端，前端只调自己的 API）。

---

## 四、其他安全提醒

仓库源码里原本硬编码了两个 GitHub Token（`ghp_sVyl...`、`ghp_Pu0b6...`），**均已从代码中删除**。
这两个 token 曾在公开仓库里暴露过，**建议立即到 GitHub 设置里吊销并重新生成**。

后台管理密码仍是 `0978004710_27015150111_admin`（沿用原逻辑，登录后台时弹窗输入）。
它同样硬编码在 `AdMiN_AdMiN.html` 里且仓库公开 —— 建议改成运行时输入或换成一串自己的口令。

---

## 五、本地调试

```bash
cd yuguo-official
python3 -m http.server 8899
# 打开 http://127.0.0.1:8899/index.html
```

任何静态服务器都行；`file://` 协议下 `localStorage` 与 `fetch` 行为受限，不建议。
