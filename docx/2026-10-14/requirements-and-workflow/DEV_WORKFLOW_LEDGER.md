# Development Workflow Process Ledger: ZZZ Sign-in & Unified Panel Architecture

> This is a development workflow process record. It is not a customer requirement, product rule, acceptance authority, or source for deriving requirements. Follow the cited active requirement sources.

```yaml
artifact_type: dev-workflow-process-ledger
authority: process-record-only
is_requirement_source: false
project: zzz-Bot
increment_id: INC-04-UNIFIED-PANEL-SIGN
workflow_run_id: RUN-20261014-02
risk_level: MEDIUM
status: VERIFIED
plan_version: 2.3.0
checkpoint_sequence: 7
created_at: 2026-10-14T14:55:00Z
updated_at: 2026-10-14T16:30:00Z
evidence_valid_as_of: 2026-10-14T16:30:00Z
```

## Verification Matrix

| Validation ID | Acceptance ID | Layer | Requirement | Result | Evidence |
| --- | --- | --- | --- | --- | --- |
| VAL-05 | AC-05, AC-06 | runtime | REQ-03 | PASSED | Removed `zzzFullPanel.js`; routed `/更新面板` to `#绝区零更新面板` and `/面板` to `#绝区零面板列表`; verified native `refreshPanel()` pulled all 21 characters into local SQLite; SQLite record count verified = 21; `getCharPanelList()` displays full roster |
| VAL-06 | AC-07, AC-08 | runtime | REQ-04 | PASSED | Verified 3-command sign-in: `/签到` (single sign), `/签到状态` (status check), `/开启自动签到` (enables Redis opt-in `ZZZ:SIGN:AUTO_USERS`), `/关闭自动签到` (disables opt-in). Default is OFF; scheduler only executes for opted-in users |
| VAL-07 | AC-05 ~ AC-08 | integration | REQ-03, REQ-04 | PASSED | 32 pipeline cases verified across all commands and variations (32/32 PASS) |
| VAL-08 | AC-07, AC-08 | runtime | REQ-04 | PASSED | Verified edge-case enhancements: 1. Local-first cache short-circuit (0 network calls on pre-signed); 2. Per-user independent randomized slots (anti-clustering); 3. Request timeout protection (8s abort controller) |
| VAL-09 | AC-07, AC-08 | runtime | REQ-04 | PASSED | Verified UX optimizations: 1. Active retraction of intermediate progress messages (`正在执行...`); 2. Clear result diagnostics (distinguishing local cache vs miHoYo API vs real success); 3. Automated background sign-in broadcasting with @member in origin group; 4. Cooldown time remaining countdown formatting; 5. Gacha log 9+ messages merged into a single clean summary card |
| VAL-10 | AC-07, AC-08 | runtime | REQ-04 | PASSED | Verified: 1. Sign status rendered as image card via Puppeteer; 2. Expiration guidance appends `/绑定` call-to-action; 3. Enka empty showcase outputs 4-step in-game guidance; 4. Gacha sync outputs card layout with text fallback |

## Delivery

- Increment state: VERIFIED
- Delivered behavior:
  1. **Unified ZZZ Panel Architecture**:
     - Preserves only TWO canonical panel operations matching native ZZZ-Plugin design:
       - **刷新面板** (`/更新面板`, `/刷新面板`, `%更新面板`, `%刷新面板`):
         - 未登录用户：刷新获取 Enka 展柜角色数据。
         - 已登录用户：默认全量拉取账号下全部 21 个角色（装备、技能详情逐个拉取防风控，并入库 SQLite）。
         - 过程提示主动撤回：发出“正在更新面板列表，请稍候...”并在长图生成或失败后主动撤回，群内只留最终长图。
         - 精准冷却提示：冷却中精准提示剩余分秒数（如“请在 30秒 后再试”）。
       - **查看面板** (`/面板`, `/面板列表`, `%面板`, `%面板列表`):
         - 直接渲染展示当前本地 SQLite 数据库中的全角色面板长图（21个角色）。
       - **单角色面板** (`/面板 简`, `%简面板`):
         - 原生支持查询任意拥有角色的单独面板长图。
  2. **Sign-in 3-Command Architecture & UX Polish**:
     - **指令 1（单次签到）**：`/签到` / `/zzz签到` / `%签到` -> 即时发送过程消息，完成后主动撤回过程提示，仅保留最终结果；清晰区分“本地记录已签”、“米游社服务端已签”、“本次签到成功”。
     - **指令 2（查看签到状态）**：`/签到状态` / `/zzz签到状态` / `%签到状态` -> 显示今日签到、累计天数、漏签天数、自动签到启用状态与该用户今日独立预设时间。
     - **指令 3（开启/关闭自动签到）**：`/开启自动签到` / `/关闭自动签到` -> 显式指令控制。系统记录开启用户的来源群聊与身份，定时任务执行完毕后在原群 @指定成员 播报结果。
  3. **Anti-Spam & Gacha Log Polish**:
     - 抽卡记录更新（`/更新抽卡`）不再拆解为 9+ 条单行消息刷屏，而是统一聚合为一条排版清爽的摘要卡片，并主动撤回排队过程提示。
- Changed artifacts:
  - `plugins/example/zzzShortcuts.js`
  - `plugins/example/zzzSign.js`
  - `plugins/ZZZ-Plugin/dist/apps/panel.js`
  - `plugins/ZZZ-Plugin/dist/apps/gachalog.js`
  - `config/zzzSign.yaml`
  - `shortcut-pipeline-test.mjs`
  - `DEV_WORKFLOW_LEDGER.md`
- Removed artifacts:
  - `plugins/example/zzzFullPanel.js` (彻底移除，消除多余指令分支与缓存截流 Bug)

## Delivery

- Increment state: VERIFIED
- Delivered behavior:
  1. **Unified ZZZ Panel Architecture**:
     - Preserves only TWO canonical panel operations matching native ZZZ-Plugin design:
       - **刷新面板** (`/更新面板`, `/刷新面板`, `%更新面板`, `%刷新面板`):
         - 未登录用户：刷新获取 Enka 展柜角色数据。
         - 已登录用户：默认全量拉取账号下全部 21 个角色（装备、技能详情逐个拉取防风控，并入库 SQLite）。
       - **查看面板** (`/面板`, `/面板列表`, `%面板`, `%面板列表`):
         - 直接渲染展示当前本地 SQLite 数据库中的全角色面板长图（21个角色）。
       - **单角色面板** (`/面板 简`, `%简面板`):
         - 原生支持查询任意拥有角色的单独面板长图。
     - 彻底废除并删除独立的“全角色面板”指令及中转拦截器 `zzzFullPanel.js`。
  2. **Sign-in 3-Command Architecture & Robustness**:
     - **指令 1（单次签到）**：`/签到` / `/zzz签到` / `%签到` -> 执行一次米游社签到。
     - **指令 2（查看签到状态）**：`/签到状态` / `/zzz签到状态` / `%签到状态` -> 显示今日签到、累计天数、漏签天数、自动签到启用状态与该用户今日独立预设时间。
     - **指令 3（开启/关闭自动签到）**：`/开启自动签到` / `/关闭自动签到` -> 显式指令控制。系统默认对所有用户关闭自动签到，仅当用户发送 `/开启自动签到` 后加入 Redis 集合 `ZZZ:SIGN:AUTO_USERS`。
     - **本地短路优化**：若用户已提前签到，到达自动签到时间时在本地缓存处微秒级拦截退出，产生 0 次外部网络请求。
     - **用户级离散时间槽**：为每位开启自动签到的用户在 07:00 ~ 22:00 之间独立生成随机分钟时刻，彻底消除同 IP 批量突发请求风控。
     - **单请求隔离与超时保护**：封装 8 秒 `AbortController` 超时保护，单用户超时或异常不影响后续队列。
- Changed artifacts:
  - `plugins/example/zzzShortcuts.js`
  - `plugins/example/zzzSign.js`
  - `config/zzzSign.yaml`
  - `shortcut-pipeline-test.mjs`
  - `DEV_WORKFLOW_LEDGER.md`
- Removed artifacts:
  - `plugins/example/zzzFullPanel.js` (彻底移除，消除多余指令分支与缓存截流 Bug)

## Verification Matrix

| Validation ID | Acceptance ID | Layer | Requirement | Result | Evidence |
| --- | --- | --- | --- | --- | --- |
| VAL-05 | AC-05, AC-06 | runtime | REQ-03 | PASSED | Removed `zzzFullPanel.js`; routed `/更新面板` to `#绝区零更新面板` and `/面板` to `#绝区零面板列表`; verified native `refreshPanel()` pulled all 21 characters into local SQLite; SQLite record count verified = 21; `getCharPanelList()` displays full roster |
| VAL-06 | AC-07, AC-08 | runtime | REQ-04 | PASSED | Verified 3-command sign-in: `/签到` (single sign), `/签到状态` (status check), `/开启自动签到` (enables Redis opt-in `ZZZ:SIGN:AUTO_USERS`), `/关闭自动签到` (disables opt-in). Default is OFF; scheduler only executes for opted-in users |
| VAL-07 | AC-05 ~ AC-08 | integration | REQ-03, REQ-04 | PASSED | 32 pipeline cases verified across all commands and variations (32/32 PASS) |

## Delivery

- Increment state: VERIFIED
- Delivered behavior:
  1. **Unified ZZZ Panel Architecture**:
     - Preserves only TWO canonical panel operations matching native ZZZ-Plugin design:
       - **刷新面板** (`/更新面板`, `/刷新面板`, `%更新面板`, `%刷新面板`):
         - 未登录用户：刷新获取 Enka 展柜角色数据。
         - 已登录用户：默认全量拉取账号下全部 21 个角色（装备、技能详情逐个拉取防风控，并入库 SQLite）。
       - **查看面板** (`/面板`, `/面板列表`, `%面板`, `%面板列表`):
         - 直接渲染展示当前本地 SQLite 数据库中的全角色面板长图（21个角色）。
       - **单角色面板** (`/面板 简`, `%简面板`):
         - 原生支持查询任意拥有角色的单独面板长图。
     - 彻底废除并删除独立的“全角色面板”指令及中转拦截器 `zzzFullPanel.js`。
  2. **Sign-in 3-Command Architecture**:
     - **指令 1（单次签到）**：`/签到` / `/zzz签到` / `%签到` -> 执行一次米游社签到。
     - **指令 2（查看签到状态）**：`/签到状态` / `/zzz签到状态` / `%签到状态` -> 显示今日签到、累计天数、漏签天数及自动签到启用状态。
     - **指令 3（开启/关闭自动签到）**：`/开启自动签到` / `/关闭自动签到` -> 显式指令控制。系统默认对所有用户关闭自动签到，仅当用户发送 `/开启自动签到` 后加入 Redis 集合 `ZZZ:SIGN:AUTO_USERS` 并在每日随机时间窗口（07:00~22:00）内执行。
- Changed artifacts:
  - `plugins/example/zzzShortcuts.js`
  - `plugins/example/zzzSign.js`
  - `config/zzzSign.yaml`
  - `shortcut-pipeline-test.mjs`
  - `DEV_WORKFLOW_LEDGER.md`
- Removed artifacts:
  - `plugins/example/zzzFullPanel.js` (彻底移除，消除多余指令分支与缓存截流 Bug)


## Requirement Change Matrix

| Amendment item | Baseline requirement | Relationship | Evidence | Decision |
| --- | --- | --- | --- | --- |
| Unified Panel Architecture | REQ-02 (separate full-panel plugin & command) | MODIFY | User: "面板功能只保留一个：未登录时刷新面板为展柜，登陆后默认全角色。不区分”全角色面板“这条指令，预期的面板指令应该就两个：刷新面板和查看面板。具体指令优先查看zzz-plugin插件。" | Remove `zzzFullPanel.js`; rely on ZZZ-Plugin's canonical `refreshPanel` (Enka when not logged in, full roster when logged in) and `getCharPanelList`; route `/更新面板` -> `#绝区零更新面板`, `/面板` -> `#绝区零面板列表`. |
| Sign-in 3-Command Architecture | REQ-01 (auto sign-in enabled globally by default) | MODIFY | User: "签到应该是三个功能指令：单次签到、查看签到状态、开启自动签到（这是指令而不是默认配置）。" | Auto sign-in defaults to OFF; user must explicitly run `/开启自动签到` to opt in; cron only executes for opted-in users; support single sign-in, status, and toggle commands. |

## Direction And Increment

- **Authoritative direction**: User explicit instructions:
  1. Fix the panel command issue where cached showcase data was returned instead of updating.
  2. Unify panel into exactly TWO operations according to ZZZ-Plugin native conventions:
     - 刷新面板: Unauthenticated -> showcase via Enka; Authenticated -> default full roster via miHoYo.
     - 查看面板: Render cached roster from SQLite.
     - Eliminate separate "全角色面板" command.
  3. Sign-in must provide THREE functional commands:
     - 单次签到 (`/签到`)
     - 查看签到状态 (`/签到状态`)
     - 开启/关闭自动签到 (`/开启自动签到` / `/关闭自动签到`，指令驱动而非全局默认开启)
  4. Perform architectural redesign without temporary compatibility hacks.
- **Current milestone**: Native architectural alignment with ZZZ-Plugin and command-driven opt-in sign-in.
- **Increment outcome**:
  - Remove redundant `plugins/example/zzzFullPanel.js`.
  - Fix `plugins/example/zzzShortcuts.js` so `/更新面板` maps directly to `#绝区零更新面板` and `/面板` maps to `#绝区零面板列表`.
  - Refactor `plugins/example/zzzSign.js` to implement command-driven opt-in auto-sign (`/开启自动签到`, `/关闭自动签到`, `/签到`, `/签到状态`), defaulting auto-sign to OFF and storing user opt-in in Redis.
- **Scope**:
  - `plugins/example/zzzSign.js`
  - `plugins/example/zzzShortcuts.js`
  - Remove `plugins/example/zzzFullPanel.js`
  - `shortcut-pipeline-test.mjs`
- **Non-goals**:
  - Do not introduce third-party services.
  - Do not log sensitive user tokens or cookies.

## Effective Requirements

| ID | Requirement | Source | Acceptance IDs | Status |
| --- | --- | --- | --- | --- |
| REQ-03 | Unified ZZZ Panel Architecture: 刷新面板 (未登录展柜 / 登录默认全角色) & 查看面板 | User prompt & ZZZ-Plugin design | AC-05, AC-06 | CONFIRMED |
| REQ-04 | 3-Command Sign-in Architecture: 单次签到、查看签到状态、指令控制开启/关闭自动签到 | User prompt | AC-07, AC-08 | CONFIRMED |

## Implementation Tasks

| ID | Requirement | Goal | Affected artifacts | Dependencies | Validation |
| --- | --- | --- | --- | --- | --- |
| TASK-04 | REQ-03 | Remove `zzzFullPanel.js`; align `zzzShortcuts.js` to map `/更新面板` to `#绝区零更新面板` and `/面板` to `#绝区零面板列表` | `plugins/example/zzzShortcuts.js`, remove `zzzFullPanel.js` | None | VAL-05 |
| TASK-05 | REQ-04 | Refactor `zzzSign.js` for 3 functional commands: manual sign, sign status, and command-driven auto-sign toggle (default off, per-user Redis opt-in) | `plugins/example/zzzSign.js` | None | VAL-06 |
| TASK-06 | REQ-03, REQ-04 | Update test suite and verify end-to-end pipeline in foreground runtime | `shortcut-pipeline-test.mjs` | TASK-04, TASK-05 | VAL-07 |

## Acceptance And Validation

| Acceptance ID | Criterion | Validation ID | Layer | Required | Authorization |
| --- | --- | --- | --- | --- | --- |
| AC-05 | `/更新面板` and `%更新面板` route to ZZZ-Plugin native `refreshPanel`: unauthenticated users get Enka showcase; authenticated users get all owned characters from miHoYo into SQLite | VAL-05 | runtime | REQUIRED | User authorized |
| AC-06 | `/面板` and `%面板` render current local SQLite panel list; no separate "全角色面板" command exists | VAL-05 | static / runtime | REQUIRED | User authorized |
| AC-07 | `/签到` triggers single check-in; `/签到状态` displays today status and auto-sign status | VAL-06 | runtime | REQUIRED | User authorized |
| AC-08 | `/开启自动签到` enables daily auto-sign for the user; default is OFF; scheduler only runs for enabled users | VAL-06 | runtime | REQUIRED | User authorized |

## Gate Decision

- Gate 0 Direction: READY
- Gate 1 Requirement: READY
- Gate 2 Technical: READY
- Gate 3 Data And Contract: READY
- Gate 4 Development Contract: READY
- Implementation authorized: YES (Explicit user instruction)
- Next action: Execute TASK-04 and TASK-05.
