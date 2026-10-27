# dsh-plugin-delete

删除增强插件 for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH)：删除工作区时可在**同一个确认框**里选择是否连带删除其全部会话记录与实体文件夹内容；会话菜单内提供「删除会话」；并为模型提供 `delete_records` 工具。

A delete-experience plugin for DeepSeek Harness: one unified confirmation when deleting a workspace with opt-in removal of its session records and folder contents, a "Delete session" menu action, and a model-facing `delete_records` tool.

中文 | [English](#english)

- [English](#english)

---

## 为什么需要它

DSH 原生只有三样东西：

| 原生行为 | 结果 |
|---|---|
| 删除工作区 | 只解除注册，会话日志与实体文件全部保留 |
| 归档会话 | 会话可隐藏，但**没有删除能力**，日志永久累积 |
| 实体文件夹 | 宿主从不管理 |

时间一长，`~/.dsh/sessions/` 下的会话日志与投影缓存无限增长，实体项目文件夹也要手动清理。本插件补齐这块能力：**注册表、会话记录、实体文件夹**三层各自独立可选删除，且危险操作全部显式勾选、不可恢复前明确告知。

## 功能

### 1. 统一删除工作区确认框

在工作区「...」菜单点击「删除工作区」，弹出的确认框里直接包含两个可勾选选项：

- **同时删除其 N 条会话记录**（`~/.dsh/sessions/` 日志 + 投影缓存 + 注册表归档/置顶记录）
- **同时删除工作区文件夹下的所有文件**（递归，含隐藏文件）

两项默认不勾选（默认行为与原生一致：只解除注册）。确认后一次完成所选内容，并给出逐条结果汇总。

> 兜底：若接管失败（如宿主 UI 在后续大版本改版），插件仍会在宿主原生确认框走完后的清理框里提供同样的选项，功能不会丢失。

### 2. 删除会话

每个会话「...」菜单末尾新增红色「删除会话」项：停止进行中的工作（回合、子代理、定时任务）→ 释放界面引用 → 删除会话日志与投影缓存 → 清理注册表记录。当前会话不可自删（有保护）。

### 3. Agent 工具 `delete_records`

与上述 UI 完全同一套宿主实现（单一实现、两个调用方）。模型可调用它按会话 ID 删除记录、或清空指定工作区文件夹：

```json
{ "action": "sessions", "sessionIds": ["session-..."] }
{ "action": "folder", "folderPath": "C:/path/to/project" }
```

运行中的实时会话会先被停止，其文件在关闭后自动补删（Windows 文件锁友好）。

## 安全边界

- 文件夹删除有硬性守卫：盘符根目录、`$DSH_HOME`（含其内部）、用户主目录本身一律拒绝。
- 删除即物理删除（无回收站），确认框明确警示「不可恢复」。
- 当前运行会话不会被工具自删（`refused-self-delete`）。
- 插件只做删除：不读会话内容、不上传任何数据、纯本地运行。

## 安装

### 从源码（当前可用）

```bash
git clone https://github.com/rapidrabbitsliu/dsh-plugin-delete
```

在 DSH 的 **插件管理器**（桌面端「设置 → 插件」或 `dsh` Web GUI）中选择「从本地目录安装」，指向上面的克隆目录即可，安装后立即生效（无需重启）。

### 从 npm（即将发布）

```bash
# 发布完成后在插件管理器中直接搜索 dsh-plugin-delete 安装
```

## 已知限制

- 正在运行的会话：文件需等会话关闭后删除（UI 会提示「关闭中」，插件监听关闭事件自动补删，另有 60 秒兜底定时器）。
- 「统一确认框」接管依赖宿主菜单的 React 结构（已在 0.2.1-rc.3 上验证识别链路），若未来宿主 UI 改版导致接管失效，会自动回退到「先原生确认、后补充清理」的兜底流程，不会丢功能。
- 多开页面时，删除工作区后最先弹出清理框的那个页面生效，其余页面自动失效。
- 文件夹删除按绝对路径执行：请确保删除时该路径仍指向期望目录。

## 开发

无构建步骤：Host 半区（`index.js`）与 Client 半区（`client.js`）均为纯 JS，locale 位于 `locale/`。

```bash
node --check index.js && node --check client.js
```

本地开发安装（pnpm link 到 profile 后，改代码 + 重启宿主即生效）。

机制速览：

- **Host 半区**：注册 `/plugin-delete/api/*` 私有 HTTP 路由（Client 桥）；注册 `delete_records` 工具；监听注册表域变更捕获「工作区注册被删」生成兜底清理要约（长轮询 25s）。
- **Client 半区**：`window` 捕获阶段拦截删除点击（DOM 文本 + React fiber 双通道识别工作区归属），渲染自建对话框（主题令牌 `--dsw-alias-*` 自适应明暗）；会话菜单行经 `sidebar.workspaces.session.menu.item` 插槽注入。

## 许可证

[MIT](LICENSE)

---

<a id="english"></a>
# English

## Why

DSH natively only offers three things:

| Native behavior | Result |
|---|---|
| Delete workspace | Removes the registration only; session logs and real files are kept |
| Archive session | Sessions can be hidden, but there is **no delete capability**; logs accumulate forever |
| Real folders | Never managed by the host |

Over time `~/.dsh/sessions/` grows without bound and project folders need manual cleanup. This plugin adds the missing capability across all three layers — **registry entry, session records, real folder** — each independently optional, with every destructive action explicitly checked and clearly announced as irreversible.

## Features

### 1. Unified delete-workspace confirmation

Clicking **Delete workspace** in a workspace's "..." menu opens a single confirmation that includes two opt-in options:

- **Also delete its N session records** (logs under `~/.dsh/sessions/`, projection caches, and registry archive/pin entries)
- **Also delete all files in the workspace folder** (recursive, including hidden files)

Both default to unchecked (same as native: registration only). On confirmation everything you selected is executed in one pass, with a per-item result summary.

> Backstop: if the takeover ever misses (e.g. after a host UI redesign), the plugin still offers the same options in a cleanup dialog right after the native confirmation, so nothing is lost.

### 2. Delete session

A red **Delete session** row is appended to every session's "..." menu: it stops running work (turns, subagents, schedules), releases the main-view reference, deletes the session log and projection cache, and scrubs registry records. The current session cannot self-delete (guarded).

### 3. Agent tool `delete_records`

The exact same host implementation behind the UI (one implementation, two callers). The model can delete records by session id or wipe a workspace folder:

```json
{ "action": "sessions", "sessionIds": ["session-..."] }
{ "action": "folder", "folderPath": "C:/path/to/project" }
```

Live sessions are stopped first; their files are removed once they close (Windows-friendly).

## Safety boundaries

- Hard guards for folder deletes: drive roots, `$DSH_HOME` (including everything inside), and the home directory itself are refused.
- Deletes are physical (no trash); the dialog warns clearly that removal is permanent.
- The running session refuses self-deletes (`refused-self-delete`).
- The plugin only deletes: it never reads conversation content and never uploads anything — fully local.

## Install

### From source (available now)

```bash
git clone https://github.com/rapidrabbitsliu/dsh-plugin-delete
```

In the DSH **Plugin Manager**, choose "install from local directory" and point it at the cloned folder. Takes effect immediately, no restart needed.

### From npm (coming soon)

Search for `dsh-plugin-delete` in the Plugin Manager once published.

## Known limitations

- Running sessions: files are removed after the session closes (the UI says so; a close-event listener plus a 60s fallback timer finish the job).
- The unified confirmation takeover depends on the host menu's React structure (verified against 0.2.1-rc.3). If a future host redesign breaks the takeover, the flow automatically falls back to native confirmation + follow-up cleanup dialog.
- With multiple open pages, the first cleanup dialog to act wins; the others invalidate themselves.
- Folder deletes resolve the absolute path you pass at delete time — make sure it still points where you mean.

## Development

No build step: the host half (`index.js`) and client half (`client.js`) are plain JS; locales live in `locale/`.

```bash
node --check index.js && node --check client.js
```

Mechanism sketch:

- **Host half**: private HTTP routes under `/plugin-delete/api/*` (client bridge); registers the `delete_records` tool; watches the workspace registry domain to catch "registration deleted" events and emits fallback cleanup offers (25s long-poll).
- **Client half**: a window-capture click interceptor (DOM text + React fiber dual-signal identification of the owning workspace row) renders custom dialogs styled purely with `--dsw-alias-*` theme tokens; the session menu row is injected through the `sidebar.workspaces.session.menu.item` slot.

## License

[MIT](LICENSE)
