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

本包以 DSH **组合包**（bundle）形式分发（`package.json` 的 `dsh.bundle` 指向自带的 `cordis.patch.yml` 配置层）。用 `dsh` CLI 安装进 profile（[文档：打包与安装插件](https://deepseek-harness.github.io/deepseek-harness/develop/basic/publish)）：

```bash
# 从本地 checkout 安装
git clone https://github.com/houyanchao/dsh-timeline.git
dsh plugin --profile web add ./dsh-timeline

# 或直接从 GitHub 安装
dsh plugin --profile web add github:houyanchao/dsh-timeline
```

由于包声明了 `dsh.bundle`，`dsh` 会自动把它追加进该 profile 的 `dsh.profile.bundles` 列表。之后用该 profile 启动 Web UI：

```bash
dsh --profile web
```

可用 `dsh --profile web --dump-config` 查看组合后的配置树，应能看到 `dsh-timeline` 条目。

> **注意**：本包通过 `prepare` 脚本构建 `lib/`。若从 GitHub 安装时提示构建脚本被拦截，把 `dsh-timeline-plugin` 加入 profile 的 `pnpm-workspace.yaml` 中的 `allowBuilds` 列表后重试（见上方文档）。

## 开发

```bash
pnpm install     # 安装依赖（prepare 脚本会构建一次）
pnpm typecheck   # TypeScript 类型检查
pnpm bundle      # 单次构建（tsdown）
pnpm watch       # 监听变更自动构建
```

若只想快速迭代、不安装进 profile，也可以通过 `--patch` overlay 加载插件——见[第一个插件](https://deepseek-harness.github.io/deepseek-harness/develop/basic/)。

源码按功能分目录（`src/client/` 下的 `timeline/`、`starred/`、`notepad/`、`smartInputBox/`、`quickAsk/`、`conversationExport/`、`formula/`、`panelModal/`，以及共享的 `ui/` 基础组件）。`MIGRATION.md` 记录了与原 Chrome 插件逐文件的迁移对照。

## 许可证

[GPL-3.0-or-later](./LICENSE)
