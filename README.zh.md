# DSH Timeline

[English](./README.md) | **简体中文**

[DeepSeek Harness (DSH)](https://deepseek-harness.github.io/deepseek-harness/) 原生插件：为会话提供时间轴导航、收藏文件夹、闪记、提示词库，以及一系列输入与阅读增强。

由 [AI Timeline Chrome 插件](https://github.com/houyanchao/chatgpt-gemini-timeline) 全保真迁移而来——交互、样式、逻辑与原版一致，并基于 DSH 插件架构重新实现（槽位组件 + 会话快照数据，不再爬取 DOM）。

<!-- 功能总览图（占位） -->
<!-- ![功能总览](./docs/overview.png) -->

## 功能

### 时间轴
- **会话右侧时间轴**：每个提问一个圆点，按消息实际位置成比例布点；密集会话自动切换紧凑模式，长会话虚拟化渲染。
- **激活节点跟随滚动**；点击圆点平滑滚动到对应提问。
- **悬浮气泡**：提问时间 + 全文（点击复制）+ 收藏/图钉操作；长按圆点可直接切换图钉标记。
- **问题列表面板**：全部提问带序号列出，激活行随阅读位置联动，行内收藏/图钉。
- **方向键导航**：`↑` / `↓` 跳转上/下一个提问。
- **轴上滚轮**直接驱动主对话滚动。
- 可收起的轴条、4 种主题色、消息旁时间标签，以及 **AI 回复完成提醒**（浏览历史消息时回复完成，弹出提示 + 可选提示音）。

### 整理
- **收藏单条提问或整个会话**到两级文件夹（支持 emoji 图标）：置顶、拖拽排序、编辑、搜索。
- 侧栏底部**文件夹面板**，跨会话快速导航。
- **闪记**：可拖拽、可缩放的快速笔记面板，笔记同样可收藏进文件夹。

### 输入
- **提示词库**：保存常用提示词，一键插入输入框。
- **智能回车**：`Enter` 换行；双击 `Enter`、`Ctrl/⌘+Enter` 或 `Shift+Enter` 发送（可配置）。
- **选中追问**：选中会话中任意文本，以引用形式插入输入框继续追问。
- **发送后保持阅读位置**：向上浏览历史时发送消息，页面不再跳到底部。

### 导出与其他
- **对话导出**：Markdown / TXT / JSON / CSV / PNG / PDF，可选时间戳与图片。
- **公式复制**：以 LaTeX（多种定界符风格）或 MathML 复制数学公式。
- 设置面板逐功能开关、深浅主题跟随宿主、中英文界面、本地数据备份（JSON 导出/导入）。

## 安装

```bash
pnpm install   # 安装依赖并构建插件（prepare 脚本）
```

DSH 集成声明在 `package.json` 的 `dsh` 字段（面向 `web` 平台的客户端 bundle，注入会话 UI）。作为插件加载的方式见 [DSH 插件开发文档](https://deepseek-harness.github.io/deepseek-harness/develop/basic/)。

## 开发

```bash
pnpm typecheck   # TypeScript 类型检查
pnpm bundle      # 单次构建（tsdown）
pnpm watch       # 监听变更自动构建
```

源码按功能分目录（`src/client/` 下的 `timeline/`、`starred/`、`notepad/`、`smartInputBox/`、`quickAsk/`、`conversationExport/`、`formula/`、`panelModal/`，以及共享的 `ui/` 基础组件）。`MIGRATION.md` 记录了与原 Chrome 插件逐文件的迁移对照。

## 许可证

[GPL-3.0-or-later](./LICENSE)
