# chromeExtension → dsh-timeline-plugin 迁移清单

原浏览器扩展（`../chromeExtension`）每个文件/目录在本 DSH 原生插件中的归属。
状态：✅ 已迁移 ｜ ➖ 无对应物（原因见备注）。

## 迁移原则

- 数据来源从「爬取 chat.deepseek.com DOM」改为「useSession 订阅 Chat 快照」，
  所有为爬取服务的基建（观察器、适配器、防抖健康检查）在 DSH 里无对应物。
- 交互与样式逐参数还原：布局算法（比例布点/minGap/紧凑模式/滚动缓动）逐行移植
  自 `timeline-manager.js`，视觉参数逐条移植自原 CSS（深浅两套）。
- 存储从 `chrome.storage.local` 改为 `localStorage` + Bus（跨标签页经 `storage`
  事件同步）；命令式单例（GlobalXxxManager）改为模块单例 + React 宿主组件
  （`UiHost` 挂 `shell.overlay` 槽位）。

## timeline/（时间轴）

| 原文件 | 新归属 | 状态 |
|---|---|---|
| `timeline-manager.js`（布局/激活/滚动算法/虚拟化） | `src/client/timeline/engine.ts`（含 computeVisibleRange） | ✅ |
| `timeline-manager.js`（轴条渲染/track 联动/tooltip/图钉标记/虚拟化渲染） | `src/client/timeline/TimelineBar.tsx` | ✅ |
| `timeline-manager.js`（轴上滚轮驱动主滚动/长按圆点切换图钉 500ms/底部 padding 保证末节点可激活） | `src/client/timeline/TimelineBar.tsx`（wheel + long-press + `dsh-tl-scroll-padding`） | ✅ |
| `timeline-manager.js`（wrapper/折叠/方向键导航/AI 完成提醒触发） | `src/client/timeline/TimelineRoot.tsx` | ✅ |
| `timeline-manager.js`（tooltip 构建/复制/星标/图钉操作） | `src/client/timeline/DotTooltip.tsx` | ✅ |
| `timeline-manager.js`（DOM 观察器/健康检查/容器重绑，约 2000 行） | ➖ 数据驱动下无需 | ➖ |
| `timeline.css` + `variables.css`（timeline 段） | `src/client/timeline/timeline.module.css` | ✅ |
| `question-list/index.js` + `styles.css` | `src/client/timeline/QuestionListPanel.tsx` + 同 CSS | ✅ |
| `star-input-modal/`（收藏弹窗：主题输入 + 选文件夹） | `src/client/timeline/StarModal.tsx`（含 starEditModal 命令式 API） | ✅ |
| `notepad/`（闪记：面板/拖拽/8 向缩放/50 条上限/收藏联动） | `src/client/notepad/`（NotepadPanel.tsx + storage.ts + CSS） | ✅ |
| `chat-time-recorder.js`（提问时间标签，短/全格式切换） | `src/client/timeline/TimeLabels.tsx` + `shared/text.ts` | ✅ |
| `common.js`（存储管理器/工具） | `store.ts`（defineStore 持久化）+ `shared/text.ts` | ✅ |
| `container-finder.js`（LCA 容器查找） | ➖ DSH 有稳定的 `[data-conversation-scroll]` 锚点 | ➖ |
| `adapters/`（平台适配器） | ➖ 单一宿主，无需适配层 | ➖ |
| `index.js`（初始化/重试/路由轮询） | `src/client/index.ts`（slot 注册即生效） | ✅ |
| 图钉 pin（togglePin/renderPinMarkers/PinStorageManager） | `starred/storage.ts` 的 pinsStore + TimelineBar/DotTooltip | ✅ |
| 收藏整个对话按钮（injectStarChatButton，key 尾缀 `-1`） | `src/client/timeline/TimelineAction.tsx` | ✅ |
| 激活色自定义（4 色调色板 → CSS 变量） | `shared/palette.ts` + TimelineRoot 注入 `--tl-dot-active-color` | ✅ |
| AI 完成提醒（toast + 声音，非最后节点时触发） | `shared/aiCompleteReminder.ts` + TimelineRoot 触发 | ✅ |

## 文件夹 / 收藏（sidebarStarred + starred）

| 原文件 | 新归属 | 状态 |
|---|---|---|
| 收藏/文件夹存储（chrome.storage） | `src/client/starred/storage.ts`（starredStore/starredUiStore/pinsStore/pendingNavigateStore） | ✅ |
| `sidebarStarred/`（侧栏收藏树：导航/右键菜单/拖拽/双击改名） | `src/client/starred/StarredTree.tsx`（含搜索过滤） | ✅ |
| 侧栏入口（头部：折叠/帮助提示/设置跳转/新建文件夹） | `src/client/starred/StarredPanel.tsx`（sidebar.footer.action 槽位 + 浮层；原头部搜索按钮被原版 CSS `display:none !important` 永久隐藏，不迁移） | ✅ |
| `folder-edit-modal/`（图标选择器 + 名称输入） | `src/client/starred/FolderEditModal.tsx` | ✅ |
| 文件夹 CRUD/菜单构建工作流 | `src/client/starred/actions.tsx` | ✅ |
| 各处 SVG 图标 | `src/client/starred/icons.tsx` | ✅ |
| 全部相关 CSS（sidebarStarred + panelModal starred tab + 编辑弹窗） | `src/client/starred/starred.module.css` | ✅ |
| `adapters/`（宿主会话列表集成：原生三点菜单注入「收藏到文件夹」、会话行星标图标、`hideStarredFromNativeList` 隐藏已收藏会话、拖动原生会话入文件夹） | ➖ DSH sidebar 契约仅有 workspaces/settings/footer.action 三个槽位，无会话行级/菜单注入点，无法以公开 API 实现；如需恢复需 hack 宿主 DOM，暂不迁移 | ➖ |
| 外部 URL 拖入文件夹即收藏 | ➖ DSH 收藏按 sessionId 寻址，任意 URL 无法映射会话，不再适用 | ➖ |

## smartInputBox/（提示词 + 输入框增强）

| 原文件 | 新归属 | 状态 |
|---|---|---|
| `prompt-button-manager.js`（提示词按钮 + 定位） | `src/client/smartInputBox/PromptButton.tsx`（conversation.input.left 槽位） | ✅ |
| `prompt-dropdown-ui.js`（下拉：搜索/列表/常用设置 tab） | 同上（PromptDropdown 组件） | ✅ |
| 提示词存储（增删改/置顶/排序/上下移） | `src/client/smartInputBox/storage.ts`（promptsStore） | ✅ |
| `smart-enter-manager.js`（双击 Enter / Ctrl+Enter / Shift+Enter 发送） | `src/client/smartInputBox/smartEnter.ts`（capture 拦截 composer textarea） | ✅ |
| `prompt-button.css` 等样式 | `src/client/smartInputBox/smartInput.module.css` | ✅ |
| 版本更新 Logo 按钮（提示词按钮旁 + 小红点） | `src/client/changelog/ChangelogModal.tsx` 的 UpdateLogoButton（原 chatTimes 使用记录门控随存储移除有意去除，展示条件仅保留 icon 模式 + 有未读更新） | ✅ |
| `animations/`（电子宠物） | ➖ 纯装饰，不在迁移范围 | ➖ |

## conversationExport/（对话导出）

| 原文件 | 新归属 | 状态 |
|---|---|---|
| `constants.js`（格式/主题/工具函数） | `src/client/conversationExport/constants.ts` | ✅ |
| 轮次采集（原滚动加载 DOM 爬取） | `src/client/conversationExport/collect.ts`（Chat 快照配对 + readAttachment 解析图片） | ✅ |
| `exporters.js`（MD/TXT/JSON/CSV + 下载） | `src/client/conversationExport/exporters.ts` | ✅ |
| `png-exporter.js`（canvas 渲染 + MathJax 公式） | `src/client/conversationExport/pngExporter.ts` | ✅ |
| `pdf-exporter.js`（iframe 打印，可选中文本） | `src/client/conversationExport/pdfExporter.ts` | ✅ |
| 导出弹窗 + 会话头部入口 | `src/client/conversationExport/ExportAction.tsx`（conversation.session.header.actions 槽位） | ✅ |
| `styles.css` | `src/client/conversationExport/export.module.css` | ✅ |

## panelModal/（设置面板）

| 原文件 | 新归属 | 状态 |
|---|---|---|
| 面板骨架（侧栏 tab + 内容区 + 版本 footer） | `src/client/panelModal/PanelHost.tsx` + `panel.module.css` | ✅ |
| `tabs/timeline/`（时间标签/主题色/AI 完成提醒/防跳底/标记重点/闪记/方向键/显示时间轴） | PanelHost 的 TimelineTab（含主题色与提醒子弹窗、开启预览） | ✅ |
| `tabs/starred/`（收藏管理 + 搜索 + 面板开关） | PanelHost 的 StarredTab（复用 StarredTree） | ✅ |
| `tabs/prompt/`（提示词管理：增删改/置顶/上下移 + 按钮开关） | PanelHost 的 PromptTab + PromptModal | ✅ |
| `tabs/smartInputBox/`（智能回车模式 + 开关） | PanelHost 的 SmartInputTab | ✅ |
| `tabs/conversationExport/`（导出开关） | PanelHost 的 ExportTab | ✅ |
| 打开面板的命令式总线 | `src/client/panelModal/bus.ts`（panelModal.show(tab)） | ✅ |
| `tabs/dataSync/`（数据导入导出：JSON 文件备份/恢复，合并/覆盖两种模式） | PanelHost 的 DataSyncTab + `panelModal/dataSync.ts`（合并规则逐条对齐原 mergeByKey；Google Drive 云同步按需求不迁移，原扩展侧已下线删除） | ✅ |
| `tabs/formula/`（MathML 开关 + LaTeX 开关及复制格式单选） | PanelHost 的 FormulaTab（格式选择随 LaTeX 开关内联显隐） | ✅ |
| chrome 专属 tab（about/animation；runner tab 已随 runner 删除） | ➖ 不在 DSH 迁移范围 | ➖ |
| 按平台分组开关（platform modal） | DSH 单平台折叠为单行开关（子弹窗保留原视觉） | ✅ |

## preventAutoScroll/（发送后防跳底）

| 原文件 | 新归属 | 状态 |
|---|---|---|
| `index.js`（rAF 锚定/用户滚动预算/可信导航/开关联动） | `src/client/shared/preventAutoScroll.ts`（逐行移植 ScrollAnchor） | ✅ |
| 发送捕获：Enter capture + 点击发送按钮 | Enter capture 保留；点击发送按钮（普通消息不经过 phase 提交态、无稳定按钮选择器）由「pointerdown 位置快照 + 草稿 COMMIT 清空（send-committed）确认」触发；斜杠命令由 InputState.phase 跃迁到提交态触发 | ✅ |
| 生成态检测（adapter.isAIGenerating） | ConversationSnapshot.running 由 React 侧喂入 | ✅ |
| 时间轴导航声明可信滚动（notify/settleUserNavigation） | `timeline/engine.ts` 的 smoothScrollTo 已接线 | ✅ |

## quickAsk/（选中追问）

| 原文件 | 新归属 | 状态 |
|---|---|---|
| `index.js`（平台门控/会话页判定/URL 变化监听/开关联动） | 槽位挂载（composer 槽位仅存在于会话页）+ settingsStore 开关，无需 URL 轮询 | ✅ |
| `quick-ask-manager.js`（选区检测/有效性白名单/浮动按钮六方位定位与回退/引用格式化） | `src/client/quickAsk/QuickAskButton.tsx`（逐参数移植） | ✅ |
| `_insertToInput`（contenteditable / Slate / textarea 三分支） | DSH composer 为受控 textarea，走 `inputActions.setDraft`（textarea 分支等价物） | ✅ |
| `styles.css` + variables.css 的 `--ait-quick-ask-*`（深浅两套） | `src/client/quickAsk/quickAsk.module.css` | ✅ |
| 设置开关（panelModal smartInputBox tab 的 quickAskSection） | PanelHost 的 SmartInputTab + `quickAskEnabled` | ✅ |
| `selection-copy.js` + 复制按钮（_syncCopyButton，公式触发 + text/html 与 text/plain 双格式写入） | `src/client/quickAsk/selectionCopy.ts` + QuickAskButton 的复制按钮（复用 formula/parser + formats；配置改 settingsStore 同步读取） | ✅ |

## formula/（公式复制）

| 原文件 | 新归属 | 状态 |
|---|---|---|
| `index.js`（初始化/storage 开关监听/卸载清理） | `src/client/formula/FormulaHost.tsx`（挂 UiHost，settingsStore 订阅驱动启停/重扫） | ✅ |
| `formula-manager.js`（扫描 .katex/hover 高亮/点击复制/复制反馈） | `FormulaHost.tsx` 的 FormulaEngine（DSH 正文同为 KaTeX 渲染，选择器与提取逻辑原样保留） | ✅ |
| `formula-manager.js`（tooltip：文字 + 设置入口，formula 类型配色/hideDelay 200/allowHover） | `FormulaHost.tsx` 的 FormulaTooltip 组件（定位/边界修正逐参数移植） | ✅ |
| `formula-manager.js`（多格式下拉菜单：虚拟 trigger 居中、宽 260、top-left） | 复用 `ui/dropdown.tsx`（原 globalDropdownManager 等价物） | ✅ |
| `latex-extractor.js`（FormulaSourceParser：LaTeX 提取/合法性校验/MathML 转换/Word 前缀） | `src/client/formula/parser.ts`（逐函数移植） | ✅ |
| `libs/temml.min.js`（LaTeX → MathML 引擎） | npm 依赖 `temml`（打包内联） | ✅ |
| `global/constants.js` 的 FORMULA_FORMATS + applyFormulaFormat | `src/client/formula/formats.ts` | ✅ |
| `formula.css`（交互高亮/tooltip/设置 icon） | `src/client/formula/formula.module.css`（深色经 data-tl-dark，原 html[data-timeline-theme] 等价物） | ✅ |
| DOMObserverManager 节流+防抖扫描（各 2s） | FormulaEngine 内 MutationObserver 复刻同策略 | ✅ |
| `url:change` 自动清理交互标记 | 会话切换（currentSessionId 变化）时清理 | ✅ |
| 复制反馈降级方案（自建 .timeline-copy-feedback 元素） | ➖ DSH 下全局 toast 恒可用，无需降级 | ➖ |
| `formulaLatexEnabled` / `formulaMathMLEnabled` / `formulaFormat` 存储 | `shared/settings.ts`（缺省 开/关/none，与原版一致） | ✅ |

## global/（通用基建）

| 原目录 | 新归属 | 状态 | 备注 |
|---|---|---|---|
| `toast-manager/` | `src/client/ui/toast.tsx` | ✅ | 含 AI 完成提醒胶囊样式 |
| `tooltip-manager/` | `src/client/ui/tooltip.tsx` | ✅ | |
| `dropdown-manager/` | `src/client/ui/dropdown.tsx` | ✅ | 多级子菜单 |
| `popconfirm-manager/` | `src/client/ui/popconfirm.tsx` | ✅ | |
| `input-modal/` | `src/client/ui/inputModal.tsx` | ✅ | |
| `i18n.js` | `src/client/locales.ts`（locale 服务） | ✅ | |
| `changelog-modal/` | `src/client/changelog/`（数据/弹窗/Logo 按钮，已读走 localStorage） | ✅ | |
| `ai-complete-reminder-toast/` | `src/client/shared/aiCompleteReminder.ts`（提示音 base64 内嵌） | ✅ | |
| `constants.js`（SITE_INFO/平台工具） | ➖ 单一宿主 | ➖ | |
| `dom-observer-manager\|url-change-monitor\|event-delegate-manager\|resource-loader\|ai-state-monitor` | ➖ 爬取基建/宿主职责（生成态改用 ConversationSnapshot.running） | ➖ | |

## 全局设置存储

| 原存储 key | 新归属 | 状态 |
|---|---|---|
| `timelinePlatformSettings` / `sidebarStarredPlatformSettings` / `promptButtonPlatformSettings` / `smartInputPlatformSettings` / `conversationExportPlatformSettings` | `src/client/shared/settings.ts`（settingsStore，单平台布尔开关） | ✅ |
| `chatTimeLabelEnabled` / `aitNotepadEnabled` / `arrowKeysNavigationEnabled` / `preventAutoScrollEnabled` / `quickAskEnabled` / `timelineActiveColors` / `smartEnterMode` / `smartEnterToastCount` / `timelineAICompleteToastEnabled` / `timelineAICompleteSoundEnabled` | 同上 | ✅ |
| `chatTimelineStars` / 文件夹 / 图钉 / 闪记 | `starred/storage.ts` + `notepad/storage.ts` | ✅ |
| `ait-changelog-read-version` | `changelog/data.ts` | ✅ |

## 不迁移（无对应物）

| 原目录 | 备注 |
|---|---|
| `mermaid/`（图表渲染） | 已从 chromeExtension 删除（含 runner 侧集成），不迁移 |
| `runner/`（代码运行器） | 沙箱页依赖扩展机制；已从 chromeExtension 删除（含 panelModal runner tab、manifest sandbox 配置、i18n 词条），不迁移 |
| `background.js`（Google Drive 备份） | 已从 chromeExtension 删除（云同步下线），不迁移 |
| `manifest.json`、`_locales/`、`icons/`、`images/`、`assets/` | 扩展打包物（logo/提示音已 base64 内嵌） |
| `popup/`（引导页）、`scripts/`（打包脚本） | 扩展专属，已从 chromeExtension 中删除 |
