# DSH Timeline

[简体中文](./README.md) | **English**

A native [DeepSeek Harness (DSH)](https://deepseek-harness.github.io/deepseek-harness/) plugin that adds a conversation timeline, starred folders, quick notes, a prompt library and a set of input & reading enhancements to your chat sessions.

Fully migrated from the [AI Timeline Chrome extension](https://github.com/houyanchao/chatgpt-gemini-timeline) with interaction, styling and logic parity — re-implemented on top of DSH's plugin architecture (slot components + session snapshots, no DOM scraping).

<!-- Feature overview image (placeholder) -->
<!-- ![Feature overview](./docs/overview.png) -->

## Features

### Timeline
- **Timeline rail** on the right side of the conversation: one dot per question, placed proportionally to its position, with a compact mode for dense sessions and virtualized rendering for long ones.
- **Active node tracking** synced with your scroll position; click a dot to smooth-scroll to that question.
- **Hover tooltip** with question time and full text (click to copy), plus star / pin actions; long-press a dot to toggle its pin marker.
- **Question list panel**: numbered list of all questions, active row follows your reading position, inline star / pin actions.
- **Keyboard navigation**: `↑` / `↓` jump to the previous / next question.
- **Mouse wheel on the rail** drives the main conversation scroll.
- Collapsible rail, 4 accent colors, message time labels, and an **AI completion reminder** (toast + optional sound) when a reply finishes while you are reading earlier messages.

### Organize
- **Star messages or whole conversations** into two-level folders with emoji icons; pin, drag-and-drop reorder, edit and search.
- **Folder panel** in the sidebar footer for quick navigation across sessions.
- **Notepad**: a draggable, resizable quick-notes panel; notes can be starred into folders too.

### Input
- **Prompt library**: save frequently used prompts and insert them into the composer with one click.
- **Smart Enter**: `Enter` inserts a newline; send with double-`Enter`, `Ctrl/⌘+Enter` or `Shift+Enter` (configurable).
- **Quick Ask**: select any text in the conversation and quote it into the composer as a follow-up question.
- **Keep reading position on send**: sending a message while reading earlier history no longer jumps the page to the bottom.

### Export & more
- **Conversation export** to Markdown / TXT / JSON / CSV / PNG / PDF, with optional timestamps and images.
- **Formula copy**: copy math formulas as LaTeX (multiple delimiter styles) or MathML.
- Settings panel with per-feature toggles, light / dark theme following the host, English / Chinese UI, and local data backup (export / import JSON).

## Installation

This package ships as a DSH **bundle** (`dsh.bundle` in `package.json` points to its `cordis.patch.yml` layer). Install it into a profile with the `dsh` CLI ([docs: package and install a plugin](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/publish)):

```bash
# from a local checkout
git clone https://github.com/houyanchao/dsh-timeline.git
dsh plugin --profile web add ./dsh-timeline

# or install straight from GitHub
dsh plugin --profile web add github:houyanchao/dsh-timeline
```

Because the package declares `dsh.bundle`, `dsh` appends it to the profile's `dsh.profile.bundles` list automatically. Then launch the Web UI with that profile:

```bash
dsh --profile web
```

You can verify the composed configuration with `dsh --profile web --dump-config` — a `dsh-timeline` row should appear.

> **Note**: the package builds `lib/` via its `prepare` script. If a GitHub install reports blocked build scripts, add `dsh-timeline-plugin` to the `allowBuilds` list in the profile's `pnpm-workspace.yaml` and retry (see the docs above).

## Development

```bash
pnpm install     # install deps (prepare script builds once)
pnpm typecheck   # TypeScript type check
pnpm bundle      # build once (tsdown)
pnpm watch       # rebuild on change
```

For quick iteration without installing into a profile, you can also load the plugin through a `--patch` overlay — see [your first plugin](https://deepseek-harness.github.io/deepseek-harness/develop/basic/).

Source layout: one directory per feature under `src/client/` (`timeline/`, `starred/`, `notepad/`, `smartInputBox/`, `quickAsk/`, `conversationExport/`, `formula/`, `panelModal/`, plus shared `ui/` primitives). `MIGRATION.md` documents the file-by-file mapping from the original Chrome extension.

## License

[GPL-3.0-or-later](./LICENSE)
