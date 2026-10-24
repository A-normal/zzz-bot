# 云崽渠道生态复用与 Game-Hub 三向微内核架构落地规范

- **方案提出时间**: `2026-10-25 00:05:00 +08:00`
- **核心结论**: **Yunzai 现有的消息渠道能力（Adapters）不仅 100% 可以复用，而且必须作为底层传输宿主进行深度复用！**
- **复用原则**: **“不重复造轮子，专注于应用层门面包装”**。由 Yunzai 承接底层的物理协议与网络传输，由 Game-Hub 承接业务语义归一化与动态调度。

---

## 一、 为什么必须复用 Yunzai 现有的渠道能力？

如果在 `Game-Hub` 中从零重新编写 QQ（OneBot/NapCat）、Telegram、Discord、微信等协议客户端，将产生巨大的技术负债与维护成本：
1. **协议层极其繁琐**：WebSocket 断线重连、心跳保活、Token 刷新、分片上传、语音转码、Webhook 验签等；
2. **Yunzai 现有渠道已经高度成熟**：
   - 内置了 `OneBotv11`、`ComWeChat`、`Milky`、`Satori`、`GSUIDCore` 等大量适配器；
   - 社区生态已有完善的 `Telegram-Plugin`、`QQBot-Plugin` 等扩展插件；
   - 具备开箱即用的底层 Puppeteer / Shotium 截图服务。

**因此，最优雅、最高效的工程路线是：**
> **让 Yunzai 充当“传输宿主（Transport Host）”，让 Game-Hub 充当“业务门面与治理中枢（Application Facade & Governance Hub）”。**

---

## 二、 职责边界划分：传输宿主 vs 门面总线

```text
+-----------------------------------------------------------------------------------------+
|                                外部聊天网络 (External Chat Networks)                    |
|                        QQ (NapCat/OneBot)  |  Telegram  |  官方 QQBot                   |
+-----------------------------------------------------------------------------------------+
                                            │
                                            ▼
+-----------------------------------------------------------------------------------------+
|                    【传输与协议宿主】：Yunzai / TRSS-Yunzai Adapter 体系                |
|                                                                                         |
|   - 职责：只负责底层的物理连接与协议解析（TCP/WS/HTTP），产出原生事件 raw `e`          |
|   - 维护：NapCat 握手、TG Long-Polling、QQBot Webhook、图片/语音流上传下载              |
+-----------------------------------------------------------------------------------------+
                                            │
                                            ▼ 原生事件 e (格式各异、存在缺陷)
+=========================================================================================+
|                   ★【三向治理中枢】：Game-Hub (作为 Yunzai 顶层优先级插件)              |
|                                                                                         |
|   1.【渠道事件轻量整形 (Inbound Shaper)】                                               |
|      - 统一身份主键: 将异构 ID 规范化为 `qq:123456` 或 `tg:797397`                      |
|      - 意图统一对齐: 自动抹平 Telegram 无 @Bot 判定、QQBot at 段差异                     |
|      - 自适应输出代理: 包装 e.reply，遇到 Markdown 在 TG 直发，在 QQBot 自动渲染为图片   |
|                                                                                         |
|   2.【中央动态路由调度 (Dynamic Namespace Router)】                                     |
|      - 读取部署员自定义配置 (config/namespaces.yaml)                                    |
|      - 剥离前缀 (*, /, %) -> 提取纯语义指令 -> 注入社区上下文 -> 精准派发               |
|                                                                                         |
|   3.【东向社区驱动管理 (Community SPI)】                                                |
|      - 挂载 provider-mihoyo (米游社)、provider-kuro (库洛)                              |
|      - 统一管理通行证、Token、DS签名与游戏角色 UID 映射                                 |
+=========================================================================================+
                                            │
                                            ▼ 纯语义指令 (Pure Tokens) + 统一上下文 (Context)
+-----------------------------------------------------------------------------------------+
|                               【北向】：纯游戏业务插件 (Game Plugins)                   |
|                        game-plugin-zzz  |  game-plugin-hsr  |  game-plugin-wuwa         |
|   - 开发者不再编写任何前缀正则，不再感知底层是 QQ 还是 TG，只写纯游戏业务逻辑          |
+-----------------------------------------------------------------------------------------+
```

---

## 三、 Game-Hub 是如何无侵入复用 Yunzai 渠道的？

Game-Hub 在 Yunzai 中形态极其轻巧，它就是一个**标准的前置 Yunzai 插件（Priority: -1000）**，通过“装饰器模式（Decorator Pattern）”对原生 `e` 进行增量赋能：

### 3.1 渠道身份与消息规范化（Inbound Shaper）
```javascript
export class GameHubInboundMiddleware {
  static shapeEvent(e) {
    // 1. 规范化渠道类型与全局唯一用户标识
    const adapterName = e.adapter?.name || e.bot?.adapter?.name || "QQ";
    let channel = "qq";
    if (/telegram/i.test(adapterName)) channel = "telegram";
    else if (/qqbot/i.test(adapterName)) channel = "qq-official";
    
    // 构造全局跨端主键，如 "qq:1904107636" 或 "tg:797397241"
    e.unifiedUserId = `${channel}:${e.user_id}`;

    // 2. 统一 @Bot 判定（抹平 Telegram 差异）
    if (!e.atBot && channel === "telegram") {
      const botName = e.bot?.info?.username || "";
      if (botName && new RegExp(`@${botName}\\b`, "i").test(e.msg)) {
        e.isAtBot = true;
        // 自动剥离文本中的 @Bot 后缀
        e.msg = e.msg.replace(new RegExp(`@${botName}\\b`, "i"), "").trim();
      }
    } else {
      e.isAtBot = !!e.atBot;
    }

    // 3. 增强 e.reply 支持自适应能力整形
    const rawReply = e.reply.bind(e);
    e.replyAdaptive = async (content, opts = {}) => {
      // 若内容包含 Markdown，且当前处于官方 QQBot 这种不支持 MD 的渠道
      if (opts.markdown && channel === "qq-official") {
        // 动态调取 Puppeteer 渲染为高清卡片图片发出
        return await renderMarkdownToImageAndSend(rawReply, content);
      }
      // 在 Telegram 或 NapCat 等支持 MD 的渠道，直接原生发送
      return await rawReply(content, opts.quote);
    };

    return e;
  }
}
```

### 3.2 动态命名空间分发（Namespace Dispatcher）
部署人员在 `plugins/game-hub/config/namespaces.yaml` 中配置：
```yaml
namespaces:
  zzz:
    prefix: "*"               # 部署员 A 喜好星号
    aliases: ["zzz", "绝区零"]
  wuwa:
    prefix: "/"               # 鸣潮用斜杠
    aliases: ["鸣潮"]
```

运行时，Game-Hub 在 `accept(e)` 阶段执行快速匹配与剥离：
```javascript
async accept(rawEvent) {
  const e = GameHubInboundMiddleware.shapeEvent(rawEvent);
  
  // 匹配部署员配置的前缀
  const match = this.dispatcher.matchNamespace(e.msg);
  if (!match) return false; // 非游戏指令，放行给其他普通插件（如查天气、日常闲聊）

  const { gameId, cleanText } = match; // 例如 gameId: "zzz", cleanText: "便签"
  const gamePlugin = this.registry.getGamePlugin(gameId);
  
  if (!gamePlugin) {
    await e.reply(`[Game-Hub] 已命中 ${gameId} 前缀，但当前未安装该游戏插件。`);
    return "return";
  }

  // 精准调用游戏业务，彻底绕过 Yunzai 全局正则扫描！
  return await gamePlugin.dispatch(cleanText, e);
}
```

---

## 四、 这种复用架构带来的四大硬核红利

1. **开发工作量剧降 80%**：
   - 彻底免去编写 TCP/WebSocket 连接池、重连逻辑、登录凭证管理的数千行胶水代码；
   - 整个 `Game-Hub` 核心代码量可以控制在极简规模（< 1500 行纯粹的高效路由与状态管理代码）。
2. **多端生态天然继承**：
   - 部署人员明天想接入微信（`ComWeChat`）、后天想接入私有网关（`Satori` / `GSUIDCore`），`Game-Hub` 与所有上层游戏插件**一行代码不用改，天然直接支持**！
3. **彻底根除“正则打架”与“指令劫持”**：
   - 传统的 Yunzai 插件是将各自的正则一股脑扔给系统，靠插件加载顺序和优先级碰运气；
   - 复用后，Game-Hub 在第一优先级（-1000）将流量按部署人员定义的命名空间进行**结构化分流**，非当前游戏指令直接放行，当前游戏指令精准派发，从根源上杜绝了像喵喵面板抢兑换码这类荒唐问题。
4. **游戏插件获得绝对纯净度**：
   - `game-plugin-zzz` 只需要编写游戏业务（圣遗物计算、式舆战绩抓取、卡片排版）；
   - 社区通信找 `provider-mihoyo`，消息回复直接调 `e.replyAdaptive`，代码轻盈且极易维护。

---

## 五、 结论与落地策略

**完全复用 Yunzai 渠道能力，是当前最科学、最成熟的架构解法。**

它让我们既**坐享了 Yunzai 多渠道协议栈的巨大红利**，又通过 `Game-Hub` **彻底终结了 Yunzai 原生正则无序抢占、游戏与原神强行捆绑的历史顽疾**，完美达成了您所要求的：“底层社区独立、顶层指令独立、命名空间动态、渠道自然畅通”的理想境界！
