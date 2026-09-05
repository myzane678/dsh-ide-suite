# Changelog

本包版本与更新记录。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [0.1.0] - 2026-09-05

首个版本。从 dsh-ide-layout 1.5.x `mount.tsx` 的 QuestionPin 组件原样剥离为独立插件（大都督的点子），行为与原版一致：

- 视口第一条可见消息行向前找最近一条用户提问；提问滚出视口时，agent 区顶部（会话头部下方）浮现「↩ 这条回答对应：…」黑色胶囊条（单行截断），点击平滑跳回该提问；提问在视口内 / 新会话无消息行时隐藏。
- 定位锚 `[data-conversation-scroll]` 上缘（= 会话头部底缘，不随内容滚动变化），不压「对话/静默」tab、Session log 与宿主浮动按钮，不拦截头部点击。
- 纯浏览器端外挂：portal 到 body、被动监听（scroll 捕获 + rAF 节流 + 消息流式更新的 MutationObserver），零宿主 DOM 改动，卸载全清理。
- 依赖 dsh-client-ui-conversation 的锚点体系（行容器 `[data-chat-anchor-key]`、行类型 `data-chat-flow-kind="user"`、滚动容器 `[data-conversation-scroll]`）。
- 不依赖 dsh-ide-layout，可单独安装；host 侧为空实现。
