# Changelog

本包版本与更新记录。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [0.3.0] - 2026-09-18

菜单让位专项：任意下拉菜单打开期间置顶条自动隐藏，关闭立即恢复；层级定格 z-9 不再与官方元素比高低。

### 新增

- **菜单让位**（`useMenuOpen()`，替代原 `useSettingsOpen()`）：让位条件从「设置面板打开」扩展为两类信号——①设置面板打开（原有行为保留）；②任意 `aria-haspopup='menu'` 且 `aria-expanded='true'` 的触发按钮打开（open-in-app 的文件资源管理器/VS Code/PyCharm/Git Bash 下拉等）。菜单打开期间组件不渲染、关闭即恢复。
- **全局属性观察替代逐按钮换绑**：observer 直接对 `document.body` 开子树观察 `aria-expanded`/`aria-haspopup` 突变（attributes + childList），官方重建触发按钮节点也不会漏检；顺带移除原 rebinder 逐节点 observe 的脆弱结构。

### 变更

- **置顶条 zIndex 12 → 9**：反编译官方包实测层级梯子——右侧文件面板 10、对话区内容层最高 8（拖拽手柄 8/回底钮 8/输入框 7）。9 高于全部内容层（置顶条始终悬浮在消息流上方），低于右侧面板（面板打开时盖住置顶条末端，面板优先）。

### 修复

- **下拉列表被置顶条压住**：open-in-app 下拉走官方 Menu 就地渲染（编译类名 `_list_1nxmc_`，z100，非 portal），其祖先链存在层叠上下文封顶对外层级，置顶条（body portal z9/旧 z12）实测盖在其上。纯 z 比拼两轮踩坑（抬官方容器→置顶条被会话区盖；z4→被会话内容盖）后改用让位模式：下拉开门、置顶条让座，行为上不可能再压住。配合皮肤 v0.0.5 的弹层抬层双保险。

## [0.2.0] - 2026-09-12

实时跟随专项：接入布局完成事件，拖拽期间逐帧同帧贴合聊天列。

### 新增

- **布局完成事件接入**：监听 `dsh-ide-layout-applied`（可选增强，不引入对 dsh-ide-layout 的包依赖，未安装该插件时滚动/resize/DOM 观察路径不变）：`detail.dragging` 为真（拖拽帧）只做轻量几何直写，否则全量扫描——侧栏/编辑区/聊天区拖动与开合时置顶条逐帧同帧跟随。

### 变更

- **拖拽帧同帧直写定位**：布局事件到达时同步计算并直写按钮 `left/top/width`（React state 提交晚一帧造成的可见拖尾消除），state 仅承担文案、显隐与初值；坐标与文案均不变时不重渲染。
- 卸载时注销布局事件监听，清理完整。

## [0.1.1] - 2026-09-06

### 修复

- **置顶条压住宿主设置面板**：设置模态 z-1000 原地渲染在侧栏 DOM 子树内（受限层叠上下文，非 body portal），压不过 body 层 z-12 的置顶条——设置打开时置顶条悬浮在设置界面之上。新增 `useSettingsOpen()`：监听设置触发按钮（`[data-slot='sidebar.settings']`）的 `aria-expanded`（与皮肤/ide-layout 检测设置开合的信号一致，宿主重建触发按钮后自动重绑），**设置打开期间组件不渲染让位，关闭即恢复**（ide-layout v1.5.1 编辑器让位同款方案）。

## [0.1.0] - 2026-09-05

首个版本。从 dsh-ide-layout 1.5.x `mount.tsx` 的 QuestionPin 组件原样剥离为独立插件（大都督的点子），行为与原版一致：

- 视口第一条可见消息行向前找最近一条用户提问；提问滚出视口时，agent 区顶部（会话头部下方）浮现「↩ 这条回答对应：…」黑色胶囊条（单行截断），点击平滑跳回该提问；提问在视口内 / 新会话无消息行时隐藏。
- 定位锚 `[data-conversation-scroll]` 上缘（= 会话头部底缘，不随内容滚动变化），不压「对话/静默」tab、Session log 与宿主浮动按钮，不拦截头部点击。
- 纯浏览器端外挂：portal 到 body、被动监听（scroll 捕获 + rAF 节流 + 消息流式更新的 MutationObserver），零宿主 DOM 改动，卸载全清理。
- 依赖 dsh-client-ui-conversation 的锚点体系（行容器 `[data-chat-anchor-key]`、行类型 `data-chat-flow-kind="user"`、滚动容器 `[data-conversation-scroll]`）。
- 不依赖 dsh-ide-layout，可单独安装；host 侧为空实现。
