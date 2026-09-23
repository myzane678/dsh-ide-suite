# Changelog

本项目版本与更新记录。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [1.9.5] - 2026-09-23

改进：白色会话区横向可拉伸（插件自建双手柄）+ 手柄竖线按可见白卡分段；修复滚到底部反弹。**适用版本：DSH Desktop 2.0.9**（更早版本未验证）。

### 新增

- **会话区宽度手柄（插件自建）**：白色对话内容列左右两缘各一条——8px 命中带跨坐白缘（`cursor:col-resize`），内部 3px 常驻灰竖线压在白缘内侧，hover/拖拽才加深；每帧按**实测白缘**归位（宿主重建 DOM、拉宽拉窄、侧栏拖动均不脱位），欢迎页 / 轨迹页没有内容列时自动隐藏。
- **对称缩放**：`contentWidthFromDrag = 起始宽 + (side === "right" ? dx : -dx) * 2`——外拖一格宽涨两格，左右两缘等量外扩；内容列 `max-width + margin:0 auto` 恒居中，**竖向中心线始终落在 agent 区中间**。热路径沿用 rAF 节流 + 「仅拖动帧启用视口外跳过渲染」。
- **宽度落点与宿主同源**：每帧直写宿主 ConversationRoot 根元素（`.uPhUma_root`）的 `--dsh-chat-user-width`——var() 只在声明元素上求值，写 body / 列 / 滚动区均无效或被 root 的 inline 值遮蔽；松手持久化到宿主的 localStorage 键 `dsh.conversation.contentWidth`。钳制同源：最小 640、硬上限 1200、动态上限 = 根宽 − 176（每侧 88px 手柄安全区，防手柄被挤出列外拖不回来）。
- **皮肤瓷片卡宽度解放**（`mount.tsx` 的 `injectContentColumnWidthFree()`）：maid-atelier 皮肤 assistant 白卡原写死 `width:min(680px,96%)`，用 `!important` 抬成跟随会话列（`width:100%`），白框才等于列宽、手柄才贴得上白缘、拖拽才拉得动白框；仅对 maid-atelier 皮肤生效，卸载随 `<style>` 一起消失。
- **宿主持有者的宽度手柄继续隐藏**：其定位公式以**卡片中心**为基准（`right: calc(50% + 列宽/2 + 24px)`），与实测白缘有偏差且在本环境下不产出可见输出，故由本插件接管，避免两套抓手。

### 变更

- **手柄竖线按「可见白卡」分段**（六轮视觉反馈）：常驻细线不再贯穿整列——只在输入框 seat 以上、视口内可见白卡的两侧分段绘制，**白卡之间的 gap 不画线**（上下各收 8px 避圆角）；命中带仍取首尾可见卡并集（整段好拖）。配套：document capture+passive 滚动监听（滚动不触发 apply、rAF 合并）、二分定位首张可见卡、边界夹滚动区与 `data-composer-seat` 顶、每帧剔除输入框 seat 内误中的卡。
- **配色**：常驻极淡中性灰、hover/拖拽才深色。
- **会话列结构定位**：从 `[data-chat-flow-kind]` 锚点向上、`[data-conversation-scroll]` 之内取最外层 max-width 为 px 的盒子（运行时类名全是哈希，旧 BFS「margin:auto + max-width」判据仅作兜底）。

### 修复

- **滚到最底部被弹回**：临时诊断的试写探针每 500ms 真写「列宽+50px」再还原，卡片周期性重排、内容总高抖动；在底部时 scrollTop 已达最大值，总高变小把 scrollTop 钳小、还原后不自动加回 → 视觉弹回。已移除真写，探针降级为只读描述。

### 已知问题（计划下版本修复）

- **非 hover 状态下仅最底部白卡的竖线清晰可见**：线元素几何正确、已在 DOM 上，但常驻色在近白卡面上对比度过低，且颜色由 mouseenter/mouseleave 事件式维护——滚动中新显示的线不重设颜色（状态粘滞）。**不影响命中带与拖拽功能**。修复方向：常驻色加深 + 颜色每帧按确定性 hover 状态设置。

### 不改动

- `centerCol` 几何、分栏手柄、绿环 / 立绘裁切 / 侧栏拖拽接管一律未碰——手柄重塑的是内容列，卡片仍铺满 agent 区。
## [1.9.4] - 2026-09-20

改进：写入/编辑卡摘要字号接入官方 token + 增减徽章加粗。**适用版本：DSH Desktop 2.0.9**（更早版本未验证）。

### 变更

- **摘要字号消费官方 token**：`tool-diff-row.tsx` 的摘要串（⇅ 图形、文件名、目录路径、错误行）由写死 `font-size:12px` 改为 `var(--dsh-content-font-size-secondary, 12px)`；增减徽章对齐官方 diffStat 的 `calc(secondary − 2px)` 公式。标题（宿主 DisclosureRow）本就消费同款 token，官方字号或字号偏移类插件（如 dsh-process-colors）现在整行联动缩放；token 缺失时回退原 12px。默认观感变化：摘要 12px → 次级档（官方 17px 档位下 15px，与读取行一致）、徽章 12 → 13px。
- **增减徽章固定加粗**：`+N / −N` 数字 `font-weight: 600`（与 ⇅ 图形同重）。

## [1.9.3] - 2026-09-19

改进：工具卡 diff 行字号接入官方 token 体系。**适用版本：DSH Desktop 2.0.9**（更早版本未验证）。

### 变更

- **diff 行字号消费官方 token**：`tool-diff-row.tsx` 的 `.ide-diffrows-body` 由写死 `font-size:12px;line-height:22px` 改为 `font:var(--dsw-font-markdown-code-block, 12px/22px var(--ds-font-family-code, ui-monospace, monospace))`——与 markdown 围栏代码块同源 token，官方主题或字号类插件（如 dsh-code-font-size）缩放该 token 时 diff 行自动跟随，外部插件无需再定向覆盖 `ide-diffrows` 类名；token 缺失时回退原 12px/22px。默认观感从 12px/22px 变为官方 token 的 11px/19px。

## [1.9.2] - 2026-09-19

修复：会话区向上快速滑动的回弹抖动治本（v1.8.0 长会话重排治理的滚动副作用）。**适用版本：DSH Desktop 2.0.9**（更早版本未验证）。

### 修复

- **向上快滑回弹抖动（治本）**：v1.8.0 的长会话重排治理（`content-visibility:auto` + `contain-intrinsic-size:auto 120px`）为常驻注入——向上快速滚动时，上方「从未渲染过」的消息行只能按 120px 估算占位，滚到跟前逐行变回真实高度（消息行普遍 200~800px），列表总高度不断跳变、滚动锚定反复校正 scrollTop，快滑惯性下校正滞后即表现为「冲过头再弹回来」的抖动；所有会话均受影响，同区域第二遍滚过（行有尺寸记忆）明显减轻。**治本方案**：该优化改为**仅拖动分栏期间启用**（拖动帧逐帧重排治理不变，拖动为水平操作、占位跳变无感），滚动路径恢复原生（列表高度恒定，抖动机制上不可能发生）；启用/停用瞬间列表总高度各跳一次，以滚动视口顶缘第一个可见消息行为锚点（始终真实渲染）做 scrollTop 位移补偿，切换无感。
- **挂钩点**：侧栏拖动、聊天分栏拖动的按下/松手共 4 处，另加拖动中侧栏 DOM 被宿主重建、插件卸载两处兜底停用，共 6 处；新增 `conversation-perf.ts` 开关模块，挂载时清热重载残留的常驻旧规则。

## [1.9.1] - 2026-09-18

修复：edit/write 工具行 diff 在 DSH Desktop 2.0.9 下完成态退化为 call_id（v1.7.0 功能回归）。**适用版本：DSH Desktop 2.0.9**（更早版本未验证）。

### 修复

- **完成态工具行文件名/diff 全丢**：2.0.9 改了完成态工具块 wire 形状——argsRaw 从 block 顶层挪进 `block.call.argsRaw`、diff 视图从 callView/resultView(`card:'diff'`) 改为 `block.meta.diffs` + 即时计算；插件仍按旧形状解析，完成态 `displayPathOf`/`diffHunksOf` 双双失败回退 call_id 兜底且无红绿 diff（流式进行中不受影响，故 v1.7.0 当时实测正常）。适配：新增 `argsRawOf()` 统一参数读取；完成态优先读 `block.meta.diffs`（宿主 appliedDiffs 同源），旧视图保留为兼容兜底；args 重建兜底补 Code Mode `file_path`/`content` 字段。
- **出错行语义对齐宿主**：`isError` 完成态不再用意图参数假装渲染 diff，只显示「文件名 + 报错行」。
- **diff 行首去 +/- 前缀**（都督需求）：删掉 `::before` 的 `+ `/`- ` 符号，行号列 + 红绿底色保留；行级浅底 × 词级深块双层高亮机制不变。

### 测试

- 新增 4 例 2.0.9 形状用例。本包 144 例全通过。

## [1.9.0] - 2026-09-18

交付卡片「在侧边栏打开/预览」改跳编辑区：点击拦截桥接。**适用版本：DSH Desktop 2.0.9**（更早版本未验证）。

### 新增

- **交付卡片直达编辑区**：主程序内置 deliverables 插件的交付文件卡片，其「打开」主按钮与下拉菜单「在侧边栏预览」原为弹出右侧侧边栏预览 tab——现改为 window 捕获阶段点击拦截，从按钮 aria-label（中英文两套文案）提取文件绝对路径，换算到当前编辑区 root 相对路径后调 `openFileInTabs()` 直接打进编辑区。
- **三条放行边界**：文案提取不出路径 / 路径在编辑区 root 之外（跨工作区文件编辑区打不开）/ exe·zip 等二进制产物（编辑区只会得到乱码文本 tab）——三者保留原生侧边栏预览行为。
- **桥接模块 `deliverable-bridge.ts`**：`extractSidebarPreviewPath` / `relativeToRoot` / `isBinaryArtifact` 纯函数可测；挂载走 try/catch 降级 + disposers 注销，失败不影响 IDE 主布局。

### 测试

- 新增 `tests/deliverable-bridge.test.ts` 13 例：路径提取（中文、英文、含空格路径、普通按钮不拦截）、root 相对化（绝对剥前缀、大小写不敏感、root 外返回 null、空 root）、二进制产物判定。本包 140 例全通过。

## [1.8.0] - 2026-09-12

DSH Desktop 2.0.9 适配 + 实时性专项：固定浮层同帧跟随、侧栏拖拽帧接管、长列表逐帧重排治理、事件链去轮询。

### 新增

- **原生侧栏拖拽帧接管**：拖拽期间由插件按指针位移**纯算术**直写分栏网格（`grid-template-columns` 弹性中列）、手柄位置与侧栏内容列宽度——零 DOM 读取、零 React 状态往返；宿主逐帧 `onDrag → setSidebar → 全树重渲染`（实测单帧 ~85ms，整窗掉到 ~12fps）被 capture 阶段拦截。松手时同步补发终值合成 `pointermove`，随真实 `pointerup` 由宿主手动冲刷**一次性交还**（整场仅一次 React 提交，宽度持久化无缝）。网格/内容列均按**结构定位**（运行时类名是 CSS Modules 哈希，不能按类名匹配）；宽度钳制与 DSH 原生一致（264–420px）；解析失败自动退回观察模式。
- **布局完成事件携带拖拽标记**：`dsh-ide-layout-applied` 移出 `!dragging` 分支、每帧派发并带 `detail.dragging`——置顶条 / MessageNav / TermFab 等 body portal 浮层得以逐帧同帧跟随。
- **会话长列表逐帧重排治理**：注入 `content-visibility: auto` + `contain-intrinsic-size`（视口外消息行跳过排版与绘制），分栏拖动单帧排版成本 ~85ms → ~3ms，长会话滚动同步受益。
- **chat-resize 纯函数模块**：聊天宽度钳制、拖拽起点/终点校验、侧栏即时同步阈值（0.5px）抽出为可测纯函数。

### 变更

- **文件树滚动条隐藏**（VS Code 同款）：经典滚动条占位导致卡片右缘不对称，改隐藏（滚轮/触控板不受影响）；卡片右边距 4 → 8px、列表右内边距 +10px，左右缝隙与体积数字留白对称。
- **Git 自动刷新冷却期不丢事件**：5s 冷却 / busy 期间的 fs 变更改为记账，冷却结束或操作完成后仅补刷一次（保留 1s 保存风暴防抖）。
- **文件监听降级去轮询**：递归 `fs.watch` 不可用时不再 3 秒 root-signature 轮询，改为目录级 watcher 集合 + 拓扑事件重建（深层变更无 3 秒延迟、无漏报）。
- **MessageNav / TermFab 监听收窄**：滚动区被宿主替换后 ResizeObserver 重绑；布局几何变化改由布局完成事件驱动（同帧测量直写），不再依赖广域 body mutation 偶然触发；TermFab 仅会话头整体替换时重探，消息流式写入零测量。

### 修复

- **工作区/会话列表显示不全**：文件树固定 `clamp(200px,46vh,720px)` 压挤列表区（19 条会话仅 4 条完整可见、46vh 随窗口浮动）→ `fitTreeHeight()` 实测收敛法（树高让位、列表保底 360px），拖拽上限同步受列表保底约束。
- **拖拽/滚动卡顿闪屏**：`apply()` rAF 合并 + `applying` 守卫断自激、body MutationObserver 相关性过滤（会话滚动区/插件宿主内变动跳过）、MessageNav 移除 2 秒轮询改滚动 rAF、聊天手柄 Pointer Capture + 松手收敛。
- **侧栏绿框拖拽帧跟随**：sidebarFrameHost 几何更新移出 `!dragging` 分支，拖动中绿框实时贴合侧栏新缘。
- **官方对话宽度手柄遮挡**：隐藏宿主 `.widthHandle[data-side=left|right]`（原生 sidebar 手柄保留，供宿主维护侧栏宽度）。

### 测试

- 13 文件 / 127 项单测全绿（新增 chat-resize 7 项）；typecheck / build / `git diff --check` 通过。

## [1.7.2] - 2026-09-06

悬浮终端钮会话页显隐：欢迎页（还没发生会话）右上角不再出现悬浮终端钮。

### 变更

- **悬浮终端钮（TermFab）会话页显隐**：显示条件从「编辑区关 + 终端关」追加为「**会话页** + 编辑区关 + 终端关」（都督需求：欢迎页还没有会话，终端入口无意义）。「是否在会话页」复用既有 Session log 按钮探测——头部按钮行里文本含 Session log 的按钮只有会话页才有：探测到 = 会话页（图标垂直居中贴其左侧 12px），探测不到 = 欢迎页/头部未渲染 → 隐藏（原「回退写死位常驻」行为移除，`TERM_FAB_FALLBACK` 仅作 state 初值）。编辑区 tab 栏终端图标与终端面板 ✕ 的既有接管逻辑不变。

## [1.7.1] - 2026-09-06

布局净化小包：移除死层立绘镜像窗 + 移除 agent 卡白纱膜 + agent 卡四角亚像素色点修复。

### 移除

- **立绘镜像窗（canvasHost）**：z:-1 死层（宿主层序下从不显示、无害挂着），字段声明 / embedWorkbench 创建 / apply 几何同步 / dispose 移除四处全删，相关注释一并清理——立绘呈现由 body 背景与 character-stage 动态 clip-path 独立承担。
- **agent 卡白纱膜（background-color）**：卡面 18% 白色平涂膜经试调 0.18 → 0.10 → 0.06 后整段移除——低 alpha 下膜只余雾感（文字垫底已由头部独立染深 `#1f2c55` 承担、圆角轮廓已由绿环/气隙系统承担），回归皮肤「中栏强制透明」设计态，立绘 100% 原色透出；dispose 还原清单保留 `background-color` 防旧版内联残留。

### 修复

- **agent 卡四角亚像素色点**：卡面弧（R=16）、绿环外弧（=clip 弧 R+GAP=22）、方角 border 带三层在角部的覆盖都到不了「卡矩形角点 ↔ 绿环外弧」之间（绿环外弧距角点 16√2−22≈0.6px），缝露 body 底色成角部色点（~3px 观感含两侧抗锯齿淡出）。修复：chatFrame content 区四角铺 radial-gradient 补块（tile 24px 贴 padding-box 角 = 卡矩形角、圆心 = 角内 16px 卡面弧心、弧内透明透下层 / 弧外填绿盖缝，21px 前透明 / 21.6px 起全绿），与 sidebarFrame 补块同构，important 反制皮肤透明规则。

## [1.7.0] - 2026-09-06

edit/write 工具行 diff 增强（行级 LCS 对齐视图）+ agent 写盘后编辑器实时刷新 + 设置面板让位塌陷修复。

### 新增

- **工具行 diff 增强**：edit / write / str_replace_editor 工具行经宿主 keyed 插槽 `tool.call.toolview` shadow 注册 DiffStatRow（新增 `src/client/tool-diff-row.tsx` + 纯函数模型 `tool-diff-model.ts` 可单测；三把 wire 工具名 key 全注册 + `export const inject` 登记 `slots` + 12 次指数退避重试 + `<html data-ide-diffstat="key=状态">` 注册结果自证）。收起行 = 中文三态标题（正在编辑/正在写入/读取 → 编辑/写入/读取）+ 按扩展名文件图标（json→{}、md→⇅、README→ⓘ）+ 目录段容器查询响应式（≤420px 隐藏，选择器 `div[data-ide-diffstat]`）+ 绿红滚动数字徽章 +N/−N（0 值方向不显示，逐字符竖轮 transition，prefers-reduced-motion 关闭）；展开 = 行级 LCS 对齐 diff（上下文行保留、红绿只标真实变化行、统一行号列、行内 word 高亮、超 1500 行退化整块、头 8+尾 8 折叠、复制按钮、footer `└ +N -M · K file`），统计口径 = 对齐后真实变化行数（10 行换 1 行显示 +1 −1）；文本 `pre-wrap + overflow-wrap: anywhere` 折行、底色铺满整行随 agent 区宽度变化（行号只标逻辑行首行）。
- **编辑器实时刷新**：index.ts `syncOpenTabs`——agent 写盘后（fs 事件防抖）自动重读打开的未 dirty 文本 tab，内容变化才写 store（`contentRevision` 计数）→ CodeMirrorPane effect 以 `Transaction.remote` 全量注入：不误置 dirty、照发 LSP didChange 防幽灵诊断；dirty tab 绝不覆盖（写回时二次校验）。

### 修复

- **设置塌陷**：设置面板让位只藏编辑器（workbench display:none）未同步撤 centerCol `margin-left` → 中间 642px 空洞露窗口底色。修复：`settingsOpen()` 提前到 apply 上部计算，中栏 margin/minWidth 与编辑器显隐同源联动（设置开 → margin 归 CARD_GAP 回两栏位；关 → 恢复挤压）——让位与挤压永远同源。
- **abdicate 防御**：edit 工具 settled block 的 `resultView` 是显式 `null`（wire 序列化），`view !== undefined` 判空漏 null → 渲染崩 → SlotErrorBoundary abdicate 退休回落内置（Edit 行永远旧形态）。修复：truthy 判空（`view != null`）+ 类型 `| null`。

## [1.6.0] - 2026-09-05

浮岛卡片化布局（三分区圆角卡 + 绿色气隙 + 立绘镜像窗）+ VS Code 式预览模式 + 终端独立面板 + 十项视觉修复。同仓库新包 `dsh-question-pin`（0.1.0）承接原「这条回答对应哪条提问」置顶条（见「移除」）。

### 新增

- **浮岛卡片化布局**：三分区（侧栏 / agent 卡 / 编辑区）改圆角浮岛卡 + 绿色气隙 + 双立绘镜像窗（character-stage 动态 clip-path）。
- **VS Code 式预览模式**：文件树右键「以预览方式打开」→ 斜体标题预览 tab（只读、禁保存）；Markdown 文件渲染成文档视图（markdown-it，`html:false` 防注入 + linkify，链接 capture 拦截：http(s) 新窗口打开、其余禁止——DSH 是单页应用，页内导航会冲掉整个 UI）；点击 tab / 再点文件树该文件 / 开始编辑 → 固定为正式打开（tab 合并规则：同路径已存在则激活，预览 tab 顺带固定）。
- **终端独立面板**：不开编辑区也能开终端（`editorVisible || termVisible` 任一为真即渲染中栏）；顶部手柄可拖拽高度（clamp 120px ~ 视口 70%，拖拽中直改 DOM 不抖）；编辑区与终端都关闭时右上角悬浮钮（TermFab）常驻入口——事件驱动动态对齐 Session log 按钮（resize + `dsh-ide-layout-applied` 布局事件 + MutationObserver + fonts.ready 四信号，rAF 合并，不轮询），深藏蓝实心 + 米白图标 + 金调描边。
- **编辑区工具栏图标化**：VS Code codicon 观感 16×16 线条图标（预览眼睛 / 保存软盘 / 运行播放 / 终端 / 关闭），hover 背景浮起 + 图标加深，tooltip 带快捷键说明。

### 修复

- **agent 卡四角绿环**：centerCol `box-shadow: 0 0 0 6px`（important）+ `clipPath` 外扩 `inset(-6px round 22px)`（clip-path 裁元素全部绘制输出含自身 box-shadow；盒内等效弧 16px 不变），填「矩形内、圆角弧外」四块月牙。
- **侧栏气隙带**：新建 sidebarFrame（z8 方角 border 带）填「窗缘↔侧栏」「侧栏↔窗底」缝，与 chatFrame（z9）在侧栏右缘衔接；顶部气隙 borderTop 绿；四角 radial-gradient 反圆角补块（弧内透明、弧外绿）；删 `background-clip: padding-box` 遗产（曾把顶部内弧压成 10px 致上下弧不一致，现四角统一 16px）。侧栏不用 box-shadow（spread 全向会画进标题栏 + 盖皮肤金线三重 shadow）。
- **会话头部文字染深**：皮肤米白头部文字靠深蓝飘带衬底，隐藏飘带后对比崩——内联染 header `#1f2c55`、次级 counter/caption/meta `#5b6b96`、去 text-shadow（只染 header 本体靠皮肤 color:inherit 传导，保留 hover 金色；dispose 恢复）。
- **隐藏皮肤纯装饰带**：top-trim（常驻）与 bottom-trim（仅欢迎页停驻，会盖卡底圆角与绿环底段）两条蕾丝饰带隐藏（pointer-events:none + aria-hidden，零功能，dispose 恢复）。
- **dispose 补全**：centerCol box-shadow、头部 color/text-shadow/次级色、sidebarFrame 自建节点直除。

### 移除

- **「这条回答对应哪条提问」置顶条（QuestionPin）**：剥离为同仓库独立插件 **dsh-question-pin**（0.1.0），本包不再内置（避免两插件同装时渲染双条）。QuestionPin 形态治理成果（单行截断细胶囊 + 锚 `[data-conversation-scroll]` 上缘定位，不压头部不拦点击）随组件带入新插件。

### 版本

dsh-ide-layout 1.5.1 → 1.6.0；dsh-lsp-core / python / typescript / powershell / java / rust 不变；同仓库新增 dsh-question-pin 0.1.0。

> dsh-lsp-powershell 的 vendor tgz 资产无变化，仍使用 v1.0.0 提供的 dsh-lsp-powershell-1.0.0.tgz。

## [1.5.1] - 2026-08-31

### 修复

- **编辑区盖住宿主设置面板**：设置模态（`VOzbGW_overlay`，`position:fixed; z-index:1000`）**原地渲染在侧边栏 DOM 子树内**（无 createPortal——从 DSH Desktop asar 内置源码证实），其 z-1000 被侧边栏受限层叠上下文困在 body 层编辑器之下，任何编辑器 z-index 都无法让位。修复：监听设置触发按钮（`[data-slot='sidebar.settings']`）的 `aria-expanded`（与皮肤检测设置开合的信号一致），面板打开期间编辑器外壳与聊天拖拽手柄 `display:none`（DOM/状态保留，关闭即恢复）；MutationObserver 自动跟随，按钮被宿主重建自动重绑。
- **编辑器层级治理与顶部避让**（伴随上一修复的层序整理）：
  - workbench / 聊天拖拽手柄 / 消息导航条 z-index 20/40/59 → **10**（主内容层：高于主栏内容与皮肤低层装饰，低于宿主浮层容器 `overlayLayer` 的 z-20 与各级对话框）——原 z-20 与宿主浮层同层且 DOM 靠后，会盖住设置页与皮肤装饰
  - 编辑器顶部偏移（`nativeTopInset`）在原生标题栏四级探测（WCO API → 忽略大小写 titlebar 类名 → elementsFromPoint 命中探针 → sidebar 顶部兜底）之外，**叠加皮肤顶部装饰带下缘**（`skinTopTrimInset()`，`[data-skin-chrome='top-trim']` 蕾丝帘 z-20 pointer-events:none）——降层后标签栏/工具栏会被蕾丝帘遮住，改从装饰带下缘开始后完整可见，并与聊天区头部水平对齐

## [1.5.0] - 2026-08-30

### 新增

- **代码高亮完全对齐 VS Code 默认主题**（亮色 = Light+，色值取自 microsoft/vscode 官方主题 JSON，非记忆值）：
  - 字符串恢复标志性 `#A31515`，变量/属性统一 `#001080`，控制流关键字（if/else/for/return）单独成紫色 `#AF00DB`，Markdown 标题 `#800000` 加粗，正则 `#811F3F`、转义字符 `#EE0000`、HTML 标签/属性名 `#800000`/`#E50000`、this/self 与 CSS 单位补齐
  - 去掉 VS Code 没有的装饰：关键字不再加粗、注释不再斜体；强调只斜体不变色、链接只下划线、删除线只画线（对齐 markup.* 规则）
  - 编辑器默认文字色从「继承皮肤标签色」改为 VS Code 前景色（`#000000`）
  - **暗色主题 Dark+ 默认组**：挂载时注入 `body[data-ds-dark-theme]` 高亮变量组——暗色不再依赖皮肤覆盖；顺带修复「暗主题下皮肤未覆盖的运算符/标点掉回亮色深灰 `#24292F`、深底上看不清」（现为 Dark+ 的 `#D4D4D4`）
  - 唯一保留的刻意偏差：invalid 语法错误 token 保持中性灰（红色语义只留给 LSP 报错波浪线；VS Code 官方 invalid 色为 `#CD3131`/`#F44747`，需要完全一致改 `EditorPane.tsx` 一行）
- **语言覆盖扩展（约 25 种，零新增依赖，全部来自已有 @codemirror/legacy-modes）**：
  - 配置/工程文件：Makefile/.mk、Dockerfile、.gitignore/.gitattributes/.dockerignore、.editorconfig/.npmrc/.env/.ini/.cfg/.conf/.properties、Jenkinsfile/Gradle
  - 编程语言：C#、Kotlin、Scala、Objective-C（.m/.mm）、Ruby、Lua、Swift、R、Perl、Haskell、Clojure、Erlang、F#、OCaml、VB、CoffeeScript、Julia、Tcl、Scheme、汇编（.asm/.s）
  - 其它：CMake、diff/patch、Protobuf、LaTeX、HTTP、Gherkin（.feature）、Pug/Jade
  - 状态栏展示名表（language-names.ts）同步扩展；未收录扩展名仍为纯文本（同 VS Code 行为）

### 修复

- **编辑区盖住原生标题栏**：workbench portal 与聊天拖拽手柄均为 `position:fixed; top:0`，在无边框窗口（页面内自绘标题栏「DSH Desktop v2.0.3」）上直接盖住顶栏。改为实测原生标题栏底部偏移——四级探测：① WCO API（桌面无边框窗口权威值，监听 geometrychange 自动跟随）→ ② `[class*="titlebar" i]` 忽略大小写类名 → ③ `elementsFromPoint` 命中探针（取 workbench 顶部一点的下层元素堆栈，第一个条带状元素即标题栏，完全不依赖类名——CSS 属性选择器区分大小写，驼峰类名会让小写匹配落空）→ ④ sidebar 元素顶部兜底（与 workbench 同属 frame 内容行）。浏览器等无标题栏环境全部落空回退 0（原行为）。

## [1.4.2] - 2026-08-23

### 新增

- **补全框底部预留空间**（对齐 VS Code scrollBeyondLastLine 行为）：编辑器底部始终保留 9 行空白——`EditorView.scrollMargins`（自动滚动时光标下方留空间）+ `.cm-content` `paddingBottom: 14.4em`（兜底「已滚动到底」场景，em 跟随字号缩放，任何字号下都大于补全列表自身 10em 高度）。代码写到底时补全框始终显示在光标下方，不再翻转盖住上方刚写的代码。

### 修复

- **「运行完代码后鼠标无法点击光标」偶发 bug**（点不动光标、键盘无效、拖拽还能选中）：签名提示框失焦残留——`signatureTooltipField` 只在 CodeMirror state 变化（transaction）时更新，光标在括号内弹出签名框后直接点「▶ 运行」→ 编辑器失焦但无 transaction → 签名框残留盖住编辑器 → 点击落在 tooltip DOM 上被 `eventBelongsToEditor` 判为非编辑器事件忽略（mousedown 不到编辑器，不定位、不聚焦）。补全框 autocomplete 自带 focusout/blur 清理而签名框没有；修复：`EditorView.domEventHandlers({ blur })` 失焦即清除签名框，从源头防残留（光标回括号内签名框照常弹出）。

## [1.4.1] - 2026-08-23

### 修复

- **外部 git 操作后面板/角标不刷新**：host watcher 不再整体抑制 `.git` 目录事件——`isIgnoredWatchPath` 放开 `.git`，新增 `isIgnoredDotGitPath` 只过滤高频噪声（`objects/**`、各类 `index.lock`、watchman cookie），保留 `HEAD`/`refs/**`/`index`/`ORIG_HEAD` 等关键变化。命令行（或外部工具）commit / checkout / push / pull 后，Git 面板与未提交角标自动刷新（对齐 VS Code DotGitWatcher；host 改动需重启 DSH 生效）。

## [1.4.0] - 2026-08-23

### 新增

- **Git 面板事件驱动自动刷新**（对齐 VS Code 内置 Git 思路，修复「改了 git 库内容，Git 面板不提示」）：
  - `IdeState` 新增 `gitTick` 计数器：host 递归 fs.watch（已有）→ SSE `{kind:'fs'}` → `subscribeChanges` → 400ms 防抖 → 与 `treeTick` 同源 +1
  - `GitPanel` 收到 `gitTick` 变化 → **1s 防抖**（合并保存风暴）→ **5s 冷却**（防高频）→ 自动 `git status`；stage/commit 等写操作进行中跳过（防抢 git index 锁）；gitTick 未变不重复安排；卸载清理 timer
- **Git 未提交变更角标**：
  - 侧边栏「🛠 Git」按钮蓝底白字角标（>99 显示 99+，对齐「问题」按钮样式）：SidebarTree 常驻统计（不依赖 Git 面板挂载），root/gitTick 驱动 600ms 防抖，`countGitChanges` 汇总所有嵌套仓库变更总数（root 非仓库时），root 切换竞态保护
  - Git 面板仓库下拉框每个仓库选项显示各自未提交数（`name（main）· N`，0 不显示）：选中仓库直接取最新 status，其他仓库走并行 status 请求（reposRef 镜像 + repoGen 代际保护），仓库发现 / 自动刷新 / 操作完成三处同步

### 修复

- **Git 面板 diff 展开无法收起**：`viewDiff` 补 toggle——再次点击已打开的变更行即收起（原来点开就收不回去，会一直保持展开状态）。

## [1.3.0] - 2026-08-23

### 新增

- **Java 工具链 A 方案：构建任务 + 项目运行**（`/dsh-ide/build` 路由 + build-service）：
  - host `src/host/build-service.ts`：`detectJavaProject`（BFS 下探 4 层找 pom.xml/build.gradle/settings.gradle，wrapper 优先，跳过 target/node_modules 等）、`findMainClasses`（src/main/java 主类探测）、`planBuild`（compile/test）、`runProject`（Maven 三步：compile → dependency:build-classpath → `java -cp target/classes;<deps>` 主类；Gradle 走 gradlew run）
  - `src/host/routes.ts` 新增 `/dsh-ide/build`：复用 workspace 门禁 + 并发上限，超时 120s、输出上限 8MB；Maven 多主类返回 `{ needMain, candidates }` 由前端选择；`spawnCommand` 重构——Windows `.cmd/.bat` 统一 `cmd.exe /d /s /c` + 逐参 `cmdQuote` 转义（弃 shell:true 裸拼接，防注入）；`runProcess` 参数化 timeoutMs
  - client：`api.ts` 加 `apiBuild`/`BuildResult`；新增 `BuildOutputDialog.tsx`（portal 模态：运行中/成功/失败/超时/截断/多主类选择）；`FileTree.tsx` 对项目根或标记文件右键「🔨 构建项目」「▶ 运行项目」；`mount.tsx` SidebarTree 接线（构建状态 + 换工作区丢弃守卫）
  - 测试：`tests/build-service.test.ts` 17 项（识别/wrapper 优先级/深度限制/主类探测/Maven 三步序列/编译失败短路）；全量 95 项测试 + build 通过
- **对话消息导航条 MessageNav**（`src/client/components/MessageNav.tsx`）：
  - 聊天区右缘节点条：每条真实用户消息一个短横线节点，跟随阅读位置（品牌蓝高亮）
  - 悬停「放大」复刻 DeepSeek 网页版 ScrollNav：34px 细竖轨 → 240px 消息面板（宽度过渡 + 文字渐显），指示线同步加深；点击平滑跳转 + 目标行闪烁（按需 loadOlder 补历史）
  - 动态避让：ResizeObserver 测量聊天滚动区右缘，编辑器打开时自动贴合聊天区不遮编辑器；深色主题适配；<2 条消息自动隐藏
  - `src/client/index.ts` 挂载 `mountMessageNav(ctx)`（独立容错，失败不影响 IDE 布局）

## [1.2.0] - 2026-08-22

### 新增

- **右键「🔄 重启 LSP 连接」菜单项**（「🎨 格式化文档」下方，仅当前文件有 LSP 会话时显示）：EditorPane 新增 `lspTick` state + `restartLsp` 回调——tick +1 使 LSP 订阅 useEffect 重跑，cleanup `lspCapabilities.disposeRoot(root)` 销毁当前 root 全部会话，effect 按会话组重新 `acquire` + `connect`（新 WebSocket → 宿主桥重新 spawn 语言服务器子进程）；状态栏带 3s「正在重启 LSP 连接…」提示，订阅自动回「连接中…」→「已连接」。专治 fatal（WS 1011：服务器进程退出/门禁拒绝/服务器不可用）后停止重试的「LSP 不可用」，仅重建连接不动界面状态。

### 改进

- **补全门控（对齐 VS Code 触发字符语义）**：autocompletion override source 中，非显式触发时仅光标前为标识符字符（`[\w$]`）或 `.` 才返回补全；敲完括号/逗号/空格等标点后 source 返回 null 收起补全（此时应显示签名框）。
- **签名框互斥 + 去闪烁**：`signatureTooltipField` 在补全框打开（`completionStatus !== null`）时隐藏签名框（等价 VS Code 参数提示让位）；updateListener 统一调度——括号闭合/补全框打开置 null（已在隐藏态不动防循环），括号内输入/移动则原位刷新签名内容（tooltip 不消失重弹）；响应回来时补全框已打开则丢弃（避免两框重叠）。

## [1.1.0] - 2026-08-22

### 新增

- **文件树搜索（资源管理器式）**：树顶搜索框输入即过滤（防抖 250ms）——host 新增 `/dsh-ide/search`（`fs.search` 递归 BFS 遍历授权工作区，跳过 `node_modules`/`.git`，结果 500 条 / 目录 2 万双上限防拖死，workspace gate 门禁与 realpath 防护全程复用）；结果名称命中子串高亮，文件点击打开、目录点击退出搜索并在树中展开定位到该目录；清空 / Esc 恢复完整树。新增 `tests/fs-search.test.ts`（5 项）。

### 修复

- **LSP 状态订阅硬编码四语言**：会话组列表改由 `lspCapabilities.sessionLanguages()`（注册表驱动）提供——rust 等新语言插件的状态此前无人订阅，状态栏永远显示「… LSP」（服务器实际已连接）。

## [1.0.1] - 2026-08-22

### 修复

- **非 LSP 语言状态栏语言名显示 plaintext**（1.0.0 LSP 拆分引入的退化）：json/md/yaml 等恢复真实展示名。新增轻量语法注册表 `src/client/language-names.ts`（扩展名 → 展示名，与内置语法表同步维护）；状态栏三级 fallback：`lspCapabilities.languageFor` → `languageNameFor` → `plaintext`——LSP 语言仍优先走注册表 displayName，语言路由约定不变。新增 `tests/language-names.test.ts`（本包测试 69 → 73 项）。

## [1.0.0] - 2026-08-22

LSP 拆分工程完成——本包自 v0.3.1 起 LSP 能力全部移交 dsh-lsp-core 管线，编辑器外壳语言无关化。仓库已并入 monorepo `dsh-ide-suite`（历史保留）。

### 重构（LSP 拆分工程，阶段 1-3）

- **统一 LSP 管线**：Python / TypeScript / PowerShell / Java 四语言全部走 `dsh-lsp-core` 注册表驱动链路（`lspCapabilities.acquire`），删除旧 LSP 桥（`lsp-service.ts`，370 行）与旧 `LspClient`（约 440 行）；新增语言插件零改编辑器。
- **语言知识收敛**：`lspFor` / LSP 扩展启用 / 状态栏语言名与 LSP 会话组指示全部改走 `lspCapabilities.languageFor(path)`（LanguageSummary），`languageIdForPath` 删除——编辑器零语言知识。
- **LSP 订阅统一**：诊断 / 状态 / 服务器完整错误（状态栏 hover）按会话组（sessionId）统一订阅管理；tsserver 一条会话服务 ts/tsx/js/jsx（不再每语言一进程）。
- **依赖瘦身**：pyright / typescript-language-server 移交语言插件；PSES vendor 移交 dsh-lsp-powershell。

### 修复

- 启动崩溃：client inject 漏声明 `lspRegistry`（cordis 强制 inject）与 host 入口 inject 被 tsdown 摇掉（必须显式导出）两处产物级问题。
- `.py` 文件打不开：CodeMirror 扩展跨 bundle 双副本抛 `Unrecognized extension value`——语法高亮改由本包内置表单副本构造，语言插件不注册 syntax。

### 变化

- 非 LSP 语言（json/md 等）状态栏语言名显示 `plaintext`（原显示 'json'/'markdown'）。
- 语言插件的 LSP 服务器配置（如 pyright 宽松防误报）随插件分发，见各语言插件 CHANGELOG。

## [0.3.1] - 2026-08-21

### 修复

- **编码选择菜单被覆盖**：状态栏点击编码后菜单看不到——菜单改为贴按钮上沿向上生长（`bottom` 定位，按钮上方空间不足时自动向下弹防截断）
- **浮层 z-index 统一拉满**：编辑区右键菜单 / 快速修复 / 重命名框 / 编码菜单 / blame 悬停 / 终端右键菜单 / 文件树右键菜单与新建确认遮罩的 body 浮层 z-index 统一提到 2147483000，杜绝被 workbench（z-index 20）或皮肤浮层覆盖

## [0.3.0] - 2026-08-21

### 新增

- **编辑器编码选择**：状态栏显示当前文件编码（默认 UTF-8），点击弹出编码菜单——UTF-8 / 自动检测 / GB18030 / GBK / Big5 / UTF-16 LE / ISO-8859-1；切换后以新编码重新加载文件（未保存修改先确认），保存时按所选编码写回（GBK 等中文旧文件不再乱码、不会保存成 UTF-8）；「自动检测」对乱码文件先做严格 UTF-8 校验，失败则按 GB18030 解码，检测结果回写状态栏；读取时剥离 BOM、UTF-16LE 写入带 BOM
- **图片预览**：文件树双击 png / jpg / jpeg / gif / webp / bmp / ico / avif 直接在编辑区显示图片（不再是乱码）；滚轮缩放、双击回到适合窗口、底部工具栏缩放 / 适合 / 1:1 原始大小；只读不可保存/运行；host 侧按扩展名白名单限定 MIME 并限制 25MB，防任意文件被当图片读取
- **Tab 键缩进**：无补全/snippet 时 Tab 缩进、Shift+Tab 反缩进（多行选中整块缩进），行为对齐 VS Code

### 修复

- **Enter 换行只缩进 2 空格**：CodeMirror 全局 `indentUnit` 默认为 2 空格且项目未显式设置——统一为 4 空格（`indentUnit.of('    ')` + `EditorState.tabSize.of(4)`），语言包未自设缩进单位的语言（含 Python 循环/分支自动缩进）全部按 4 空格
- **Tab 无法缩进**：原 keymap 在无补全时返回 `false`，CodeMirror 默认行为把焦点移出编辑器——补上 `indentMore` / `indentLess` fallback

## [0.2.0] - 2026-08-20

### 新增

- **GitLens 式行内 blame**：编辑器左侧 gutter 逐行标注「短 hash + 作者」（未提交行显示「未提交」），悬停浮层显示完整提交信息（提交/作者/日期/说明）；状态栏光标行显示「◉ 作者 · 相对时间 · 短 hash」；嵌套仓库自动定位（工作区根非 Git 仓库时从文件向上找最近仓库根）；整文件标注默认关闭（工具栏「○ Blame」开关，localStorage 记忆，未启用时整列不渲染）
- **PowerShell 语言智能**（PowerShell Editor Services v4.7.0 + PSScriptAnalyzer）：`.ps1` / `.psm1` / `.psd1` 的补全、悬停帮助、实时语义分析（Script Analyzer 波浪线）、跳转定义、格式化、重命名、快速修复；捆绑模块放在插件 `vendor/` 目录（从 GitHub releases / PSGallery 手动更新，不入 git 仓库）
- **Java 语言智能**：接入 Eclipse JDT Language Server；优先复用本机 Red Hat VS Code Java 扩展中的 JDTLS（JDK 21+），支持通过 `DSH_JAVA_LS_HOME` 指定；未安装 JDTLS 时自动降级为 Java 语法高亮
- **Java 单文件运行**：点击运行后用 `javac` 编译到系统临时目录，再用 `java` 执行；支持 `package` 声明，Maven/Gradle 项目请使用终端
- **终端右键菜单**：复制选中 / 粘贴 / 清屏 / **🔄 重启终端**（立即杀掉当前 shell 并重连全新 shell，无需重启 DSH）
- 编辑器右键菜单选项悬停背景加深

### 修复

- **PowerShell 语言服务器启动路径 bug**：`vendor` 相对路径按源码位置推导、打包后在 `lib/` 多上跳一级导致找不到 `Start-EditorServices.ps1`（报「命令不存在」）——改为以构建产物位置为基准
- **WebSocket 关闭闪退**：close reason 超过协议 123 字节上限时 ws 库抛错导致宿主进程退出（DSH 整体闪退）——新增 `closeWs()` 统一按 UTF-8 字节截断，覆盖语言服务器与终端全部关闭点
- **LSP 状态栏按服务器分槽**（ts / py / ps 各自独立），一个语言服务器失败不再污染其他语言的状态显示；服务器退出时完整 stderr 经 `window/logMessage` 发到界面（状态栏悬停可见全文，不再截断）
- **高亮配色去红**：字符串改暖棕、非法字符改中性灰、符号类兜底主文字色——普通高亮不再出现红色，红色只留给 LSP 诊断的红色下波浪线（错误语义唯一来源）

## [0.1.0] - 2026-08-19

- 初始发布：DSH Web GUI IDE 布局插件
- 文件树（flex 流嵌入、懒加载、右键菜单、拖拽调高）
- CodeMirror 6 编辑器 + LSP（TypeScript / Python，补全/诊断/悬停/跳转/重命名/格式化/快速修复）
- xterm 终端（node-pty）+ Git 面板 + 问题面板 + 脚本运行输出

### 安全修复（审查整改，2026-08-18）

根据独立安全审查（`dsh-ide-layout-审查整改清单.md`）完成 18 项整改：

- **P0-01** 终端/LSP WebSocket 接入与 HTTP 同级的来源校验（loopback + Host + Origin，严格要求同源 Origin，拒绝缺失/跨源/伪造 Host/DNS rebinding）
- **P0-02** PTY 改为按 canonical root 独立管理（`Map<root, handle>`）+ 连接引用计数（最后连接断开才启动回收计时）+ 禁止向新连接重放历史 transcript
- **P0-03** Git 操作要求所选 root 即仓库根（`repoTopLevel` realpath 校验），拒绝从子目录上溯操作父仓库
- **P1-01** 文件写/改名/删除前二次 canonical 校验（symlink / reparse point 缓解；如实标注无法完全消除 TOCTOU 竞态）
- **P1-02** 脚本运行接入首次确认（localStorage 记忆）+ 并发上限 3 进程
- **P1-03** LSP 增加 URI 门禁（文件 URI 必须在授权工作区内）、连接上限 8、单帧 4MB、请求 10s 超时、初始化失败主动重连（不再保留「OPEN 但未初始化」假连接）
- **P1-04** 大文件截断后只读并禁止保存（防尾部数据覆盖丢失）
- **P1-05** dirty tab 关闭 / 关闭编辑区 / 切换工作区均有保存确认守卫
- **P1-06** 异步打开文件改用函数式 update 合并（防陈旧快照覆盖并发打开的文件）
- **P1-07** 跨文件 WorkspaceEdit 写入携带 baseMtime 冲突检测，拒绝截断/工作区外目标
- **P2-01** 修复关闭活动中间 tab 时 activeTabId 指向已移除 tab 的问题
- **P2-02** 宿主 DOM 重建后自动重新挂载面板（`waitForElement` 持续监听）；sidebar 宽度实时读取
- **P2-03** 文件树 / Git 面板异步响应增加 root/repo 代际校验（generation token）
- **P2-04** LSP 客户端仅对支持语言创建（md/go/rust 等不再误拿 TS client）
- **P2-05** 诊断缓存随 root 切换 / 文件关闭清理
- **P2-06** `pnpm-workspace.yaml` 的 `allowBuilds.node-pty` 改为显式布尔值 `true`；`package.json` 锁定 `packageManager: pnpm@11.7.0`
- **P2-07** README 补充 desktop profile 必需说明、卸载/回退步骤、测试命令
- **P2-08** 新增 vitest 单测（来源校验 / LSP URI 门禁 / tab 关闭规则，17 项）+ GitHub Actions CI（typecheck → test → build）

### 功能

- 侧边栏改为文件树常驻主视图 + 右上角小图标切换 Git/问题（问题图标带诊断计数角标）
- 编辑器新增 💾 保存按钮（有未保存更改时可用）
- 编辑器 Ctrl/Cmd + 滚轮调整字号（9–24px，localStorage 记忆，状态栏显示）
- Git 面板支持嵌套仓库发现与选择（工作区根不是 Git 仓库时自动扫描子目录仓库）
- 语法高亮扩展：YAML / XML / SQL / Java / C/C++ / Rust / Go / PHP / Vue / SCSS / LESS / TOML / Batch（.cmd/.bat，自写 StreamParser）/ PowerShell / Shell（共 23 种格式）
- Markdown 高亮补充标题/强调/链接/引用/删除线配色
- 一键安装：`dsh plugin --profile desktop add "dsh-ide-layout@git+https://github.com/myzane678/dsh-ide-layout.git"`（`prepare` 自动构建）
