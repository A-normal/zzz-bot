/**
 * @file lib/game-hub/inbound-shaper.mjs
 * @description 渠道事件输入整形器：抹平各平台 (NapCat/QQBot/Telegram) 的消息与身份异构性
 */

export class InboundShaper {
  /**
   * 将原始聊天事件整形为标准的 IUnifiedEvent 接口对象
   * @param {Object} raw - 原始 Yunzai 事件对象 e
   * @param {Object} [options] - 附加上下文
   * @returns {import('./types.mjs').IUnifiedEvent}
   */
  static shape(raw, options = {}) {
    if (!raw) throw new Error("[InboundShaper] raw event is required");

    // 1. 识别渠道类型
    const adapterName = String(
      raw.adapter?.name ||
      raw.bot?.adapter?.name ||
      options.channel ||
      (raw.sub_type ? "qq" : "generic")
    ).toLowerCase();

    let channel = "qq-napcat";
    if (adapterName.includes("telegram")) {
      channel = "telegram";
    } else if (adapterName.includes("qqbot") || (typeof raw.user_id === "string" && raw.user_id.length > 20)) {
      channel = "qq-official";
    } else if (adapterName.includes("wechat")) {
      channel = "wechat";
    } else if (adapterName.includes("discord")) {
      channel = "discord";
    }

    // 2. 规范化全局统一用户标识 (unifiedUserId)
    const rawUserId = String(raw.user_id || "anonymous");
    const unifiedUserId = `${channel}:${rawUserId}`;

    // 3. 规范化群标识
    const isPrivate = !raw.group_id || raw.isPrivate === true;
    const groupId = isPrivate ? null : `${channel}_group:${raw.group_id}`;

    // 4. 提取与清洗纯文本输入，统一 @Bot 意图判定
    let rawText = String(
      raw.raw_message || raw.original_msg || raw.msg || ""
    ).trim();

    let isAtBot = Boolean(raw.atBot || raw.isAtBot);

    // Telegram 专有补偿：TG 适配器只在文本中留 @username，不生成 at 消息段
    if (channel === "telegram") {
      const botUsername = String(raw.bot?.info?.username || options.botUsername || "");
      if (botUsername) {
        const atRegex = new RegExp(`@${botUsername}\\b`, "i");
        if (atRegex.test(rawText)) {
          isAtBot = true;
          rawText = rawText.replace(atRegex, "").trim();
        }
      }
    } else {
      // 剥离 QQ 常见的 CQ 码 [CQ:at,qq=...] 与 <@!xxx> 标签
      rawText = rawText.replace(/<@!?\d+>/g, "").replace(/\[CQ:at,qq=[^\]]+\]/gi, "").trim();
    }

    // 5. 构造自适应输出能力门面 (Capability Shaper)
    const rawReply = typeof raw.reply === "function" ? raw.reply.bind(raw) : async () => {};

    const adaptiveReply = async (content, replyOpts = {}) => {
      // 针对官方 QQBot：若插件请求发送 Markdown，但平台不支持，标记为需降级渲染
      if (replyOpts.markdown && channel === "qq-official") {
        if (typeof options.renderMarkdownToImage === "function") {
          return await options.renderMarkdownToImage(content, rawReply);
        }
        // 若无渲染器，剥离部分 Markdown 标记后纯文本发送或按普通文本发送
        return await rawReply(content, replyOpts.quote);
      }

      // 对 Telegram、NapCat 等支持原生 MD 的渠道，直接原样发送
      return await rawReply(content, replyOpts.quote);
    };

    return {
      channel,
      unifiedUserId,
      groupId,
      isPrivate,
      isAtBot,
      rawText,
      reply: adaptiveReply,
      rawEvent: raw
    };
  }
}
