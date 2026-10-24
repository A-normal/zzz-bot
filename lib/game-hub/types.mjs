/**
 * @file lib/game-hub/types.mjs
 * @description Game-Hub 三向微内核核心接口与契约定义
 */

/**
 * 渠道输入事件接口（整形后）
 * @typedef {Object} IUnifiedEvent
 * @property {'qq-napcat'|'qq-official'|'telegram'|'wechat'|'discord'} channel - 渠道分类
 * @property {string} unifiedUserId - 全局统一用户主键，如 "qq:123456" 或 "tg:797397"
 * @property {string|null} groupId - 渠道群标识
 * @property {boolean} isPrivate - 是否为私聊消息
 * @property {boolean} isAtBot - 是否明确 @ 机器人
 * @property {string} rawText - 剥离 @Bot 后的干净输入纯文本
 * @property {Function} reply - 自适应发送函数 (content, options) => Promise<any>
 * @property {any} rawEvent - 原始渠道 Event 实例
 */

/**
 * 社区驱动 SPI 规范
 * @typedef {Object} ICommunityProvider
 * @property {string} id - 社区唯一驱动标识，如 "mihoyo", "kuro"
 * @property {string} name - 社区驱动中文名称，如 "米游社", "库街区"
 * @property {Object} auth - 登录鉴权相关接口
 * @property {Function} auth.createQrCode - () => Promise<{ qrUrl: string, ticket: string }>
 * @property {Function} auth.pollQrStatus - (ticket: string) => Promise<{ status: string, credentials?: any }>
 * @property {Object} roles - 角色拉取接口
 * @property {Function} roles.fetchGameRoles - (credentials: any) => Promise<Array<{ gameId: string, uid: string, region: string, nickname: string }>>
 * @property {Object} client - 网络网关调用接口
 * @property {Function} client.request - (options: any) => Promise<any>
 */

/**
 * 游戏业务插件清单规范
 * @typedef {Object} IGamePluginManifest
 * @property {string} gameId - 游戏唯一标识，如 "zzz", "hsr", "wuwa"
 * @property {string} name - 游戏显示名称，如 "绝区零"
 * @property {string} community - 依赖的底层社区驱动 ID，如 "mihoyo", "kuro"
 * @property {Array<IGameRoute>} routes - 纯语义指令路由列表
 */

/**
 * 纯语义路由条目
 * @typedef {Object} IGameRoute
 * @property {string} id - 路由唯一标识，如 "daily-note", "panel"
 * @property {string[]} tokens - 纯指令语义词元集合，如 ["便签", "体力", "note"]
 * @property {boolean} [hasArgs] - 是否支持后续入参（如 "面板 简"）
 * @property {string} description - 指令描述
 * @property {Function} action - (context: IGameContext) => Promise<any>
 */

/**
 * 注入给游戏插件的上下文
 * @typedef {Object} IGameContext
 * @property {IUnifiedEvent} event - 统一事件门面
 * @property {string} gameId - 当前游戏 ID
 * @property {string} routeId - 当前命中的路由条目 ID
 * @property {string} [args] - 提取出的业务参数文本（如角色名）
 * @property {string} [uid] - 自动从账户池提取的游戏 UID
 * @property {any} [client] - 对应社区驱动的客户端网关实例
 * @property {any} [credentials] - 对应社区的有效凭据
 */
