# 本地自托管 ZZZ Bot 环境体检与部署可行性评估报告

- **时间戳**：2026-10-13 15:49:49 (UTC+8)
- **体检目标**：针对当前 Windows 电脑开展本地自托管 ZZZ Bot 的只读环境体检，全面评估硬件资源、WSL 与 Docker 环境、虚拟化支持、现有 AI 与网络穿透服务、关键端口占用及持久化存储目录现状，给出部署架构选型与实施前置条件清单。
- **大致内容**：
  1. 系统硬件与资源基线（Windows 11 专业版 x64、32GB 内存、C 盘 720GB+ 可用空间）；
  2. WSL2 与虚拟化状态（Ubuntu-26.04 与 docker-desktop 运行中，底层 Hyper-V 完全就绪）；
  3. Docker 与 Compose 可用性（Docker Desktop 4.91.0，Engine 29.8.0，Compose v5.5.1，已稳定托管 10 个业务容器）；
  4. 现有 AI / 穿透服务诊断（Ollama 监听 `::11434`、ComfyUI 监听 `127.0.0.1:16673`、frpc/SakuraFrp 系统服务）；
  5. 端口占用核查（2536、3000、3001、6099、6379 均完全空闲）及连续高位端口推荐；
  6. 持久数据根目录现状与推荐（推荐挂载至 WSL 优先路径 `\\wsl.localhost\Ubuntu-26.04\home\bjrst\docker`）；
  7. 架构选型深度对比（首选“全部 Docker”，备选“NapCat 原生 Windows + 其余 Docker”）；
  8. 缺少的前置条件与后续配置清单。

---

## 一、系统与硬件资源基线

### 1. 操作系统版本与硬件架构
- **实际检查命令**：
  ```powershell
  Get-CimInstance Win32_OperatingSystem | Select-Object Caption, Version, BuildNumber, OSArchitecture
  ```
- **检查结果**：
  - **操作系统**：Microsoft Windows 11 专业版
  - **版本号**：10.0.26200（Build 26200）
  - **系统架构**：64 位（x64 / amd64）

### 2. 内存容量与可用状态
- **实际检查命令**：
  ```powershell
  $os = Get-CimInstance Win32_OperatingSystem
  [PSCustomObject]@{
      TotalRAM_GB = [math]::Round($os.TotalVisibleMemorySize / 1MB, 2)
      FreeRAM_GB  = [math]::Round($os.FreePhysicalMemory / 1MB, 2)
  }
  ```
- **检查结果**：
  - **总物理内存**：**31.78 GB**（约 32 GB）
  - **当前可用内存**：**6.93 GB**（已用约 24.85 GB，主要由系统常驻应用、现有 Docker 容器及开发环境占用）
  - **资源评估**：ZZZ Bot 核心、Redis 及 NapCat 容器基础内存需求仅约 500MB ~ 1.5GB，当前可用内存充裕，完全能够满足稳定部署。

### 3. 磁盘空间与分区情况
- **实际检查命令**：
  ```powershell
  Get-Volume | Where-Object { $_.DriveLetter -ne $null } | Select-Object DriveLetter, FileSystem, @{N='FreeGB';E={[math]::Round($_.SizeRemaining/1GB,2)}}, @{N='TotalGB';E={[math]::Round($_.Size/1GB,2)}}
  ```
- **检查结果**：
  - **系统盘 C: (NTFS)**：总容量 **1861.99 GB**（约 1.82 TB NVMe SSD），剩余可用 **721.97 GB**。
  - **其他磁盘**：无其他独立用户数据盘符。

---

## 二、虚拟化与容器运行时环境

### 4. WSL 发行版与运行状态
- **实际检查命令**：
  ```powershell
  wsl.exe -l -v
  ```
- **检查结果**：
  - `Ubuntu-26.04`（默认发行版）：**Running**，WSL 版本 **2**
  - `docker-desktop`：**Running**，WSL 版本 **2**
  - WSL 内部虚拟磁盘容量（`df -h /home/bjrst`）：总计 1007 GB，**可用空间 940 GB**（使用率仅 2%）。

### 5. Docker Desktop 与 Docker Compose 可用性
- **实际检查命令**：
  ```powershell
  (Get-Command docker).Source
  docker version
  docker compose version
  docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
  ```
- **检查结果**：
  - **安装路径**：`C:\Program Files\Docker\Docker\resources\bin\docker.exe`（在 Windows PATH 与 WSL `Ubuntu-26.04` 中均可直接调用）。
  - **Docker Desktop**：版本 **4.91.0**（Build 239619），状态正常。
  - **Docker Engine**：版本 **29.8.0**（API 1.56，容器运行时 containerd 2.3.4，runc 1.4.3）。
  - **Docker Compose**：版本 **v5.5.1**。
  - **当前运行中容器**：整机已有 10 个容器稳定运行（包含 `sqmusic-web/main/mysql/kugouapi`，以及 `wangnotc-services-auto_bangumi`、`openlist`、`qbittorrent`、`xunlei`、`baidunetdisk` 等）。

### 6. 底层虚拟化支持检测
- **实际检查命令**：
  ```powershell
  $features = @('VirtualMachinePlatform', 'HypervisorPlatform', 'Microsoft-Hyper-V-All', 'Microsoft-Windows-Subsystem-Linux')
  Get-WindowsOptionalFeature -Online | Where-Object { $_.FeatureName -in $features } | Select-Object FeatureName, State
  (Get-CimInstance Win32_ComputerSystem).HypervisorPresent
  ```
- **检查结果**：
  - `VirtualMachinePlatform`：**Enabled**
  - `HypervisorPlatform`：**Enabled**
  - `Microsoft-Hyper-V-All`：**Enabled**
  - `Microsoft-Windows-Subsystem-Linux`：**Enabled**
  - `HypervisorPresent`：**True**
  - **评估**：所有必要底层虚拟化功能均已完整启用，WSL2 与 Docker 运行环境极其稳定。

---

## 三、现有 AI 服务与穿透组件状态

### 7. Ollama、ComfyUI、frpc 运行现状
- **实际检查命令**：
  ```powershell
  Get-CimInstance Win32_Process | Where-Object { $_.Name -match "ollama|frpc|python" }
  Get-CimInstance Win32_Service | Where-Object { $_.Name -match "frp" }
  Get-NetTCPConnection -State Listen | Where-Object { $_.OwningProcess -in @(...) }
  ```
- **组件诊断详情**：
  1. **Ollama**：
     - **程序路径**：`C:\Users\bjrst\AppData\Local\Programs\Ollama\ollama.exe`（由 `ollama app.exe` 桌面托盘拉起）。
     - **运行模式**：Windows 用户会话桌面守护进程。
     - **监听端口**：
       - **TCP `11434`**：监听于 `[::]`（全网卡暴露，WSL 和 Docker 容器可通过 `host.docker.internal:11434` 直接访问）。
       - **TCP `60038`**：本地内部 IPC 通信端口。
  2. **ComfyUI**：
     - **程序路径**：`C:\Software\ComfyUI-aki-v3\ComfyUI-aki-v3\`
     - **运行模式**：秋叶启动器 GUI（`StableDiffusionWebUILauncher.exe`）启动专属 Python 进程。
     - **启动参数**：`main.py --port 16673 --auto-launch --preview-method auto --disable-xformers ...`
     - **监听端口**：**TCP `16673`**（**重要提示：当前仅监听于 `127.0.0.1` 环回接口**，尚未对局域网或 Docker 暴露）。
  3. **frpc（两套独立实例）**：
     - **实例 1（独立通用 frpc）**：
       - 程序路径：`C:\Software\frp\frpc.exe`（配置文件：`C:\Software\frp\frpc.toml`）
       - 运行模式：Windows 系统服务 `frpc`（由 NSSM 封装管理，开机自启）。
       - 监听端口：**TCP `16671`**（`127.0.0.1`，本地管理/仪表盘端口）。
     - **实例 2（SakuraFrp）**：
       - 程序路径：`C:\Program Files\SakuraFrpLauncher\frpc.exe`
       - 运行模式：Windows 系统服务 `SakuraFrpService`（管理 2 个工作子进程进行反向穿透隧道传输）。
       - 监听端口：仅对外发起主动连接，未占用宿主机固定监听端口。

---

## 四、网络端口占用与建议规划

### 8. 目标业务端口检查结果
- **实际检查命令**：
  ```powershell
  $targets = @(2536, 3000, 3001, 6099, 6379)
  Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in $targets }
  Get-NetUDPEndpoint | Where-Object { $_.LocalPort -in $targets }
  ```
- **检查结果**：
  - **`2536`**（ZZZ Bot WebUI 默认端口）：**未占用，完全空闲**
  - **`3000`**（NapCat WebUI / 常见 Web 端口）：**宿主机未占用，完全空闲**（Docker 容器内虽有 `kugoumusicapi` 使用容器内 3000，但未对外映射暴露宿主机端口）
  - **`3001`**（NapCat WebSocket 默认端口）：**未占用，完全空闲**
  - **`6099`**（NapCat OneBot/WebUI 常用端口）：**未占用，完全空闲**
  - **`6379`**（Redis 默认端口）：**未占用，完全空闲**

### 连续高位端口规划建议
当前机器上已占用的端口分布主要集中在 `16666 ~ 16675`（包括下载器、媒体库、本地穿透与 ComfyUI），高位端口资源非常充裕。推荐以下备选段：
1. **推荐段 A（语义对应段 - 强烈推荐）**：`25360 ~ 25369`
   - 与 ZZZ Bot 默认端口 2536 保持前缀对应，全段处于空闲状态，便于运维记忆。
2. **推荐段 B（既有习惯段）**：`16680 ~ 16689`
   - 顺延您现有的 166xx 服务端口编排规范，完全空闲。
3. **推荐段 C（标准私有高位段）**：`32000 ~ 32010`

---

## 五、持久化数据根目录现状与建议

### 9. 存储根目录对比与推荐
- **实际检查命令**：
  ```powershell
  Test-Path "C:\Library\docker"
  Test-Path "\\wsl.localhost\Ubuntu-26.04\home\bjrst\docker"
  docker inspect wangnotc-services-openlist-1
  ```
- **目录现状**：
  - `C:\Library\docker`：存在 `config` 和 `data` 目录（主要为 9 月初的历史数据）。
  - `\\wsl.localhost\Ubuntu-26.04\home\bjrst\docker`：存在 `config` 和 `data` 目录。
  - **关键事实**：当前正在运行的所有 Docker 栈（如 AutoBangumi、OpenList、qBittorrent、SqMusic 等），其 Compose 文件均存放在 `/home/bjrst/docker/config/`，其实际数据卷全部直接挂载在 `/home/bjrst/docker/data/`。
- **推荐持久数据根目录**：
  - **首选持久化根目录**：**`\\wsl.localhost\Ubuntu-26.04\home\bjrst\docker`**（WSL Linux 路径：`/home/bjrst/docker`）
  - **目录规划规范**：
    - Compose 编排文件：`/home/bjrst/docker/config/zzz-bot/docker-compose.yml`
    - Bot 核心持久化数据：`/home/bjrst/docker/data/zzz-bot/`
    - Redis 数据持久化卷：`/home/bjrst/docker/data/zzz-bot/redis/`
    - NapCat 数据与登录凭据：`/home/bjrst/docker/data/napcat/`
  - **推荐理由**：
    1. **管理统一**：与整机所有现役 Docker 服务在同一目录下统一编排、统一备份；
    2. **性能与权限兼顾**：原生位于 WSL ext4 虚拟磁盘内，避免 Windows NTFS 挂载给 Linux 容器时产生的 Linux 文件权限（`chmod`/`chown`）异常和跨文件系统 IO 吞吐开销。

---

## 六、部署架构选型论证

### 10. “全部 Docker” vs “NapCat 原生 Windows + 其余 Docker”

| 对比维度 | 方案 A：全部 Docker（首选推荐） | 方案 B：NapCat 原生 Windows + 其余 Docker（备选/降级方案） |
| :--- | :--- | :--- |
| **组件分布** | NapCat、ZZZ Bot、Redis 全进 Docker Compose | NapCat 在 Windows 运行（NTQQ+NapCat 补丁），其余组件进 Docker |
| **宿主机侵入性** | **零侵入**，宿主机不需要安装 NTQQ 与配套环境 | 需在 Windows 安装并常驻 NTQQ，产生桌面应用开销 |
| **网络拓扑** | 容器之间通过自定义 Bridge 内部网络互通，端口无需全部暴露宿主机 | 容器需通过 `host.docker.internal:3001` 反连宿主机 Windows 端口 |
| **启停与生命周期** | 纳入已有 Docker 统一管理，支持开机无感自启 | 依赖 Windows 用户登录桌面会话，需单独配置开机自启 |
| **登录与风控应对** | 通过 NapCat 容器 WebUI（端口 6099）扫码登录，极少数新号有风控几率 | 官方 Windows NTQQ 客户端，对验证码、滑块验证兼容性最好 |

- **架构选型结论**：
  - **首选推荐“全部 Docker”**：您的电脑拥有成熟规范的 Docker Desktop + WSL2 运行环境与运维经验，全容器化能实现最大程度的解耦与环境干净整洁。
  - **备选方案预留**：若 QQ 机器人账号在 Linux Docker 容器首次扫码时遭遇严格的风控验证阻断，可平滑将 NapCat 切换为 Windows 原生运行，Bot 容器只需修改 `WS_URL` 为 `ws://host.docker.internal:3001` 即可，具备完整的低成本降级通道。

---

## 七、缺少的前置条件与后续部署配置清单

在正式实施部署前，建议完成以下确认与准备：

1. **ComfyUI 跨容器网络配置（关键调整项）**：
   - 当前 ComfyUI 启动参数为 `--port 16673`，默认仅绑定在本地 `127.0.0.1` 环回接口。
   - 若 ZZZ Bot（在 Docker 中）后续需要联动 ComfyUI 生图，Docker 容器无法直接通过环回地址连通。
   - **应对方案**：在秋叶启动器高级设置中开启“允许远程访问”（即启动参数增加 `--listen 0.0.0.0`），或通过 Windows `netsh interface portproxy` 配置端口转发。
2. **Ollama 连接地址（已就绪）**：
   - Ollama 已监听在 `[::]:11434`，后续在 Bot 配置文件中直接填写 `http://host.docker.internal:11434` 即可稳定直连。
3. **QQ 机器人账号准备**：
   - 准备一个专用的 QQ 小号，建议在手机端已处于正常登录并使用过几天的状态，避免新注册账号在 Linux 异地登录触发强风控。
4. **目录初始化**：
   - 在 WSL 中创建 `/home/bjrst/docker/config/zzz-bot/` 与 `/home/bjrst/docker/data/zzz-bot/`。
