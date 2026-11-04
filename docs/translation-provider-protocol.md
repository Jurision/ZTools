# 搜索翻译服务接口核对

2026-11-05 核对官方文档。开发验证仅使用 mock transport 与明确的 fixture 凭据，未向在线翻译服务发送请求。

- 有道文本翻译：<https://ai.youdao.com/DOCSIRMA/html/trans/api/wbfy/index.html>。使用 HTTPS 表单 POST `/api`，v3 签名是 SHA-256(appKey + input + salt + curtime + appSecret)。超过 20 个字符的 input 为前 10 字符、字符数及后 10 字符；curtime 为 UTC 秒数，salt 使用 UUID。响应译文来自 translation 数组。
- 有道官方公告：<https://ai.youdao.com/gw-notice.s?page=1>，2024-04-23《文本翻译接口返回内容更新》明确写明：“不再返回有道词典相关的数据信息”。公告列举 basic、phonetic、us-phonetic、uk-phonetic、explains 等被移除字段。因此标准翻译密钥不能保证音标和词典释义；实现仅兼容解析实际返回的可选字段，不生成虚构内容。
- 独立词典接口：<https://ai.youdao.com/DOCSIRMA/html/dictionary/api/ydcd/index.html>。需要联系商务单独开通。当前实现不调用该接口，也不引入其缓存限制与额外调用费用。
- OpenAI Chat Completions：<https://developers.openai.com/api/reference/resources/chat>。兼容服务使用 POST `/chat/completions`，发送 model 和 messages，从 choices[0].message.content 读取结果。英文单词通过提示请求可选 JSON 字段 text、phonetic、meanings；不强制 response_format，以兼容只支持基础协议的服务。

搜索翻译单独选择服务：provider-settings.params['search-translation'].providerId，缺省为 builtin-youdao；不修改原有插件/离线翻译的默认服务。凭据复用 provider-settings.params 下的服务配置。使用 Electron net.fetch 复用会话代理；拒绝重定向；5 秒截止时间覆盖响应体；取消与配置变更会中止当前请求；错误提示不回显原始响应、输入或凭据。
