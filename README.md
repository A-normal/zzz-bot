# ZZZ-Bot (绝区零多通道自托管机器人)

[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![Node.js](https://img.shields.io/badge/Node.js-26_Slim-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Valkey](https://img.shields.io/badge/Valkey-8.1_Embedded-DC382D?logo=redis&logoColor=white)](https://valkey.io/)
[![TRSS-Yunzai](https://img.shields.io/badge/Core-TRSS--Yunzai-FF69B4)](https://github.com/TimeRainStarSky/Yunzai)
[![ZZZ-Plugin](https://img.shields.io/badge/Plugin-ZZZ--Plugin-FFA500)](https://github.com/ZZZure/ZZZ-Plugin)

基于 **TRSS-Yunzai** 核心与 **ZZZ-Plugin** 的自托管绝区零（Zenless Zone Zero）多通道多功能智能机器人。原生内嵌支持 **Telegram** 与 **腾讯 QQ 开放平台官方 Bot** 双通道协同，内置轻量级 **Valkey 8.1** 缓存与 Chromium 无头渲染环境，具备自包含、高安全、低资源占用与生产级抗风控特性。

---

## 🌟 核心特性与架构亮点

1. **极简自包含容器化架构**：
   - 容器内部集成 Valkey 8.1 守护进程作为缓存后端（软链接兼容 Redis API），**无需创建独立 Redis 容器**。
   - 基础镜像基于 Debian `node:slim`，预装 Chromium 无头浏览器、文楷开源字体（LXGW WenKai）与彩色 Emoji 字体，渲染面板不乱码。
   - 严格安全隔离：宿主机仅在 `127.0.0.1:16677` 暴露 Web 状态接口，缓存端口 `6379` 仅限容器内部环回访问，杜绝公网暴露风险。
2. **多通道无缝并发支持**：
   - **Telegram Bot**：官方长轮询（Long-polling）适配器，开箱即用，支持私聊与群组互动。
   - **QQ 官方机器人**：官方 WebSocket Gateway 直连（SDK: `qq-group-bot`），支持频道、群聊 @ 响应与私信会话，无需依赖三方反向客户端。
3. **高频指令与核心功能增强**：
   - **角色展柜与面板**：支持最新绝区零角色驱动盘、影画、音擎与详细战斗属性查询。
   - **抽卡记录云端分析**：自动解析抽卡日志并生成可视化卡池统计卡片。
   - **全版本卡池历史数据库**：内置 1.0 ~ 3.2 全量卡池数据库（`resources/history.json`），倒序时间线排版，单消息防超限合并输出。
   - **智能前置路由管线**：提供全套快捷指令（如 `/面板`、`/抽卡`、`/便签`、`/签到` 等），高优先级拦截并精准分流，解决多插件指令冲突。
   - **离散时间窗口自动签到**：每日在指定时间段内随机触发米游社社区签到，支持失败私信告警与状态查询。
4. **全套工业级修复补丁（Patches Included）**：
   - 针对官方 QQBot 网关短连重试、心跳死锁、凭据明文泄露及官方被动回复配额超限（40034128）等业界痛点提供完整修复补丁。

---

## 📁 仓库目录结构

```text
zzz-bot/
├── .env.example              # 环境变量配置示例模板
├── .gitignore                # 生产级 Git 忽略规则
├── docker-compose.yml        # 根目录快速启动 Compose 文件
├── README.md                 # 项目详细说明文档
├── docker/                   # 容器构建与编排方案目录
│   ├── Dockerfile            # 容器构建文件 (Debian Slim + Valkey + Chromium + pnpm)
│   ├── entrypoint.sh         # 容器启动入口脚本 (依赖自动检查与守护启动)
│   ├── docker-compose.yml    # 标准 WSL / Linux 部署编排
│   └── zzz.yml               # 宿主机桌面 Compose 兼容版本
├── config/                   # 核心功能独立配置文件
│   └── zzzSign.yaml          # 米游社自动签到离散窗口配置
├── data/                     # 模板与数据定义
│   └── zzzSign/
│       └── status.html       # 签到状态展示卡片 HTML 模板
├── resources/                # 离线与高可用数据资源
│   └── history.json          # 绝区零 1.0 ~ 3.2 全版本卡池本地数据集
├── plugins/                  # 增强插件与业务模块
│   ├── example/              # TRSS-Yunzai example 插件
│   │   ├── zzzShortcuts.js   # 高频指令前置拦截与智能路由
│   │   └── zzzSign.js        # 社区每日签到与离散定时调度
│   └── ZZZ-Plugin/           # ZZZ-Plugin 扩展与增强模块
│       └── apps/
│           ├── gachalog.js   # 抽卡记录分析与聚合
│           ├── panel.js      # 角色展柜与面板提取
│           └── poolHistory.js# 历史卡池时间线与单消息优化模块
├── patches/                  # 官方组件缺陷修复补丁集合
│   ├── qqbot-mask-account.patch       # QQBot #QQBot账号 凭据防泄露补丁
│   ├── qqbot-reconnect-fix.patch      # QQBot 网关重连与心跳保活补丁
│   ├── sessionManager.patched.js      # 修复版 sessionManager 实现文件
│   ├── pool-history-single-msg.patch  # 历史卡池单条消息合并与配额安全补丁
│   ├── poolHistory.patched.js         # 优化版 poolHistory 实现文件
│   ├── poolHistory.original.js        # 补丁前原始对比文件
│   ├── trss-plugin-mihoyologin.patch  # 米游社验证码/扫码登录补丁
│   └── miHoYoLogin.new.js             # 修复版米游社登录实现文件
├── scripts/                  # 运维维护与补丁一键应用脚本
│   ├── apply_patch.ps1                # 账号掩码补丁一键应用工具
│   ├── apply_qqbot_reconnect_patch.ps1# QQBot 重连修复热部署工具
│   ├── apply_pool_history_patch.ps1   # 卡池查询优化热部署工具
│   ├── patch_pool_history.py          # 卡池历史单条消息合并 Python 工具
│   ├── gen_patch.ps1                  # 补丁生成辅助脚本
│   ├── inspect_patch.ps1              # 补丁定位检查工具
│   └── save_diff.ps1                  # 差异对比保存工具
└── tests/                    # 路由与管线自动化测试
    └── shortcut-pipeline-test.mjs     # 快捷指令路由与优先级回归测试
```

---

## 🚀 快速开始与部署

### 1. 前置依赖
- **操作系统**：Windows 10/11（WSL2 + Docker Desktop）或 Linux 发行版（Ubuntu 22.04+）
- **容器环境**：Docker Engine 24.0+，Docker Compose v2.20+
- **网络条件**：能正常访问 GitHub、Telegram API 或腾讯开放平台

### 2. 环境变量配置
复制环境变量模板并根据实际情况配置持久化路径：

```bash
# Linux / WSL
cp .env.example .env

# Windows PowerShell
Copy-Item .env.example .env
```

`.env` 典型配置示例：
```ini
# 时区
TZ=Asia/Shanghai

# 容器内运行用户 UID/GID
PUID=1000
PGID=1000

# 数据持久化目录（挂载至容器内部 /root/Yunzai）
DATA_ROOT=/home/bjrst/docker/data/zzz-bot/yunzai

# 宿主机状态端口
BIND_IP=127.0.0.1
PORT=16677
```

### 3. 构建并启动容器

在仓库根目录下执行：
```bash
docker compose up -d --build
```

查看容器启动日志：
```bash
docker logs -f zzz-bot
```

### 4. 验证服务健康状态

请求容器健康接口：
```bash
curl http://127.0.0.1:16677/status
```
当返回 `HTTP 200 OK` 且包含 Node.js 运行状态时，代表核心服务已正常就绪。

---

## 🤖 适配器配置指南

数据目录挂载后，配置文件存放于 `${DATA_ROOT}/config/` 目录下（注意配置文件权限收紧为 `0600`）。

### 1. Telegram Bot 接入
编辑 `${DATA_ROOT}/config/Telegram.yaml`：
```yaml
permission: "master"
token:
  - "1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi" # @BotFather 申请的 Bot Token
image:
  height: 1280
  width: 1280
```
保存后，重启容器或在后台热加载即可上线。

### 2. 腾讯 QQ 官方开放平台 Bot 接入
编辑 `${DATA_ROOT}/config/QQBot.yaml`：
```yaml
permission: "master"
token:
  - "<AppID>:<AppID>::<AppSecret>:1:0"
```
> **Token 六段格式解析**：
> - 第 1 段：内部 Bot 标识（通常填 AppID）
> - 第 2 段：开放平台申请的 **AppID**
> - 第 3 段：留空（旧版 token，直连模式无需填写）
> - 第 4 段：开放平台申请的 **AppSecret**
> - 第 5 段：`1`（启用群聊与 C2C 私信消息接收）
> - 第 6 段：`0`（公域机器人模式）

---

## 📖 指令参考清单

通过前置路由插件 `zzzShortcuts.js`，系统已支持免前缀智能路由与斜杠原生拦截：

| 功能大类 | 推荐快捷指令 | 原生命令格式 | 权限 / 前置条件 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| **基础菜单** | `/帮助`, `/菜单`, `/功能`, `帮助` | `#绝区零帮助` | 全员无门槛 | 显示绝区零专属功能菜单与用法 |
| **面板查询** | `/面板 角色名`, `/更新面板` | `#绝区零角色名面板`, `#绝区零更新面板` | 绑定 UID / 游戏展柜开启 | 查询驱动盘详情、战力评分与属性 |
| **面板列表** | `/面板`, `/面板列表` | `#绝区零面板列表` | 绑定 UID | 查看当前展柜中所有已收录角色列表 |
| **便签体力** | `/便签`, `/每日`, `/体力`, `/note` | `#绝区零便签` | 绑定米游社 Cookie | 查询当前电量、活跃度、式舆进度等 |
| **抽卡分析** | `/抽卡分析`, `/抽卡记录` | `#绝区零抽卡分析` | 提供抽卡日志链接 / SK | 生成抽卡分布统计、保底水位与图表 |
| **抽卡更新** | `/更新抽卡`, `/刷新抽卡` | `#绝区零更新抽卡` | 提供抽卡日志链接 / SK | 增量拉取米游社最新抽卡记录 |
| **卡池历史** | `%卡池记录`, `%全卡池`, `%卡池历史` | `%卡池记录` | 全员无门槛 | 倒序输出 1.0~3.2 全版本卡池时间线 |
| **当期卡池** | `%当期卡池`, `%当前卡池` | `%当前卡池` | 全员无门槛 | 查询当前进行中的角色与音擎卡池 |
| **刷新卡池** | `%刷新卡池记录` | `%刷新卡池记录` | 管理员 | 从本地数据库热重载并清空 Redis 缓存 |
| **深渊战绩** | `/式舆`, `/防卫战`, `/深渊` | `#绝区零防卫战` | 绑定米游社 Cookie | 查询剧变节点与防卫战通关星数阵容 |
| **活动日历** | `/日历`, `/cal` | `#绝区零日历` | 全员无门槛 | 查看绝区零当期游戏活动排期与截止时间 |
| **米游社签到**| `/签到`, `/社区签到` | `#绝区零签到` | 绑定米游社 Cookie | 手动触发绝区零米游社社区每日签到 |
| **签到托管** | `/开启自动签到`, `/关闭自动签到` | `#绝区零开启自动签到` | 绑定米游社 Cookie | 开启/关闭每日离散时间槽自动签到 |
| **签到状态** | `/签到状态` | `#绝区零签到状态` | 绑定米游社 Cookie | 查询当前用户的签到托管与本月统计 |
| **米游社绑定**| `#米游社登录`, `#扫码登录` | `#扫码登录` | 私聊发送 | 获取米游社登录二维码并自动写入凭证 |

---

## 🛠️ 运维管理与补丁应用

本仓库在 `scripts/` 目录下提供了完善的运维工具：

### 1. 热部署 QQBot 掉线重连修复补丁
腾讯开放平台连接偶尔因心跳或网关重置中断，官方 SDK `qq-group-bot` 默认未实现指数退避重连。执行以下脚本可一键将修复后的 `sessionManager.patched.js` 部署进容器：
```powershell
.\scripts\apply_qqbot_reconnect_patch.ps1
```

### 2. 热部署全卡池防超限单消息优化
当在 QQ 官方机器人下查询全卡池时，传统多消息转发会触发 `code(40034128)` 被动回复频率超限。执行以下脚本可一键应用单消息文本倒序优化版：
```powershell
.\scripts\apply_pool_history_patch.ps1
```

### 3. 运行路由回归测试
在宿主机或容器内运行自动化测试脚本，验证前置路由规则的覆盖性与优先级：
```bash
node tests/shortcut-pipeline-test.mjs
```

---

## 🔒 安全基线与合规建议

1. **敏感配置文件保护**：
   - 生产环境中切勿将包含真实 Token、AppSecret 或米游社 Cookie 的配置文件提交至版本库。
   - 本仓库 `.gitignore` 已将 `config/Telegram.yaml`、`config/QQBot.yaml` 以及 `.env` 彻底排除。
2. **端口隔离原则**：
   - Docker Compose 严格将 Web 接口绑定至 `127.0.0.1:16677`。若需外网管理，建议配置反向代理（如 Nginx / Caddy）并强制启用 HTTPS 与 Basic Auth。
3. **安全审计补丁**：
   - 默认安装 `patches/qqbot-mask-account.patch`，彻底杜绝群内执行 `#QQBot账号` 时将 AppSecret 明文回显的严重漏洞。

---

## 📄 开源与协议

本项目基于开源生态构建，各核心组件遵循其各自的开源协议：
- TRSS-Yunzai: GPL-3.0
- ZZZ-Plugin: MIT
- Yunzai-Telegram-Plugin: GPL-3.0
- Yunzai-QQBot-Plugin: MIT
