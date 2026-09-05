# dsh-question-pin

DSH web GUI 的 agent 区置顶条插件：「这条回答对应哪条提问」。

视口里第一条可见的消息行向前找最近一条用户提问——提问不在视口内时，agent 区顶部（会话头部下方）浮现黑色胶囊条显示该提问文本（`↩ 这条回答对应：…`）；提问滚进视口则隐藏（问题就在眼前）；新会话（无消息行）时隐藏。点击胶囊条平滑跳回那条提问。

## 来源

原实现是 dsh-ide-layout `mount.tsx` 里的 `QuestionPin` 组件（大都督的点子），2026-09 剥离为独立插件——不装 dsh-ide-layout 也能单独使用。行为与原版一致（含单行截断、锚 `[data-conversation-scroll]` 上缘的定位策略）。

## 工作原理

- 纯浏览器端外挂：portal 到 body、被动监听（scroll 捕获 + rAF 节流 + 消息流式更新的 MutationObserver），零宿主 DOM 改动，卸载全清理。
- 依赖 dsh-client-ui-conversation 的锚点体系（版本依赖点）：行容器 `[data-chat-anchor-key]`、行类型 `data-chat-flow-kind="user"`、滚动容器 `[data-conversation-scroll]`。
- host 侧为空实现（浏览器-only 插件）。

## 安装（desktop profile）

1. `~/.dsh/profiles/desktop/package.json` 的 `dependencies` 加：
   `"dsh-question-pin": "link:E:/dsh-plugins/monorepo/dsh-question-pin"`
2. `dsh.profile.bundles` 数组加 `"dsh-question-pin"`
3. `node_modules` 里建链：`mklink /J dsh-question-pin E:\dsh-plugins\monorepo\dsh-question-pin`
4. 构建：monorepo 根目录 `pnpm --filter dsh-question-pin build`
5. 重启 DSH Desktop

注意：与 dsh-ide-layout v1.5.x 及更早版本同装会渲染两个置顶条（双保险），该组件已从 dsh-ide-layout 移除，两者新版本可共存。

## 构建

```sh
pnpm --filter dsh-question-pin build    # tsc -b && tsdown
pnpm --filter dsh-question-pin watch    # 增量
```

纯 client 改动，`lib/client.js` 重新构建后刷新页面即生效。

## License

MIT
