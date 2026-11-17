# Outline

A lightweight desktop code editor for macOS, built with [Tauri](https://tauri.app), React and [CodeMirror 6](https://codemirror.net).

Outline aims for the essentials of a modern editor (language servers, an integrated terminal, Git and fast project search) in a small native app with a translucent window.

![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![Platform: macOS](https://img.shields.io/badge/platform-macOS%2011%2B-lightgrey.svg)

## Features

- **Editing**: CodeMirror 6 with syntax highlighting for many languages, code folding, multi-cursor, find and replace, and word wrap.
- **Language servers**: diagnostics, completion, go to symbol, workspace symbols, quick fixes and organize imports through LSP.
- **Formatting**: format on save with Prettier, with an optional ESLint `--fix` pass.
- **Workspace**: file tree with Material icons, tabs, split editor groups, breadcrumbs, back/forward navigation, and reopening closed tabs.
- **Search and replace**: fuzzy quick open, a command palette, and project-wide search and replace (`⇧⌘H`) that respects `.gitignore`, with a preview of every change. Open files are edited in place, so replacements can be undone.
- **Status bar**: branch, problems, cursor position, indentation, line endings (LF/CRLF) and language. Click indentation or line endings to change them.
- **Integrated terminal**: multiple terminals built on xterm.js with a real PTY.
- **Tasks**: run scripts from `package.json`, `deno.json`, Cargo, Go or a Makefile with **Run Task…** (`⇧⌘B`), or run the active file with the matching interpreter.
- **Native menu bar**: File, Edit, Selection, View, Go, Run and Terminal menus that show your current keybindings.
- **Git**: a source control panel with side-by-side diffs.
- **Previews**: Markdown preview (inline or to the side) and image preview.
- **Problems panel**: all diagnostics from every open language server in one list.
- **Customization**: 10 color themes in light and dark variants, adjustable window transparency, fonts, zoom and custom keybindings.

## Language support

Outline starts a language server automatically when a matching one is installed and on your `PATH`:

| Language              | Server                                                        |
| --------------------- | ------------------------------------------------------------- |
| TypeScript/JavaScript | The project's `typescript` package (`tsc --lsp`)              |
| Rust                  | `rust-analyzer`                                               |
| Go                    | `gopls`                                                       |
| Python                | `basedpyright-langserver`, `pyright-langserver` or `pylsp`    |
| C/C++                 | `clangd`                                                      |
| Swift                 | `sourcekit-lsp`                                               |
| CSS, HTML, JSON       | `vscode-css/html/json-language-server`                        |

## Getting started

### Prerequisites

- macOS 11 or later
- [Node.js](https://nodejs.org) and [pnpm](https://pnpm.io)
- [Rust](https://www.rust-lang.org/tools/install) (stable)
- Xcode Command Line Tools: `xcode-select --install`

### Run in development

```sh
pnpm install
pnpm app
```

### Build

```sh
pnpm bundle
```

The app bundle is written to `src-tauri/target/release/bundle/macos/Outline.app`.

To build and install it to `/Applications` in one step:

```sh
pnpm release
```

### Command-line launcher

`pnpm release` also installs an `outline` command by linking `~/.local/bin/outline` to the script bundled inside the app. Make sure `~/.local/bin` is on your `PATH`.

If you build with `pnpm bundle` instead, link the command yourself after copying the app to `/Applications`:

```sh
ln -s /Applications/Outline.app/Contents/Resources/outline ~/.local/bin/outline
```

Then open a folder or file from any terminal:

```sh
outline .            # open the current folder
outline src/App.tsx  # open a file
outline              # just launch Outline
```

If Outline is already running, the path opens in the existing window.

## Usage

### Keyboard shortcuts

| Action                    | Shortcut          |
| ------------------------- | ----------------- |
| Command palette           | `⇧⌘P` or `F1`     |
| Quick open                | `⌘P`              |
| Search in files           | `⇧⌘F`             |
| Replace in files          | `⇧⌘H`             |
| Toggle sidebar            | `⌘B`              |
| Toggle panel              | `⌘J`              |
| Terminal                  | ``⌃` ``           |
| Source control            | `⌃⇧G`             |
| Problems                  | `⇧⌘M`             |
| Split editor              | `⌘\`              |
| Save without formatting   | `⌘K S`            |
| Reopen closed tab         | `⇧⌘T`             |

Run **Keyboard Shortcuts** from the command palette to see the full list.

### Settings

Settings are stored in `~/.outline/settings.json` (JSON with comments). Open the file with the **Settings** command. Changes apply as soon as you save.

```jsonc
{
  "editor.fontFamily": "Berkeley Mono",
  "editor.fontSize": 15,
  "editor.tabSize": 2,
  "editor.formatOnSave": true,
  "workbench.colorTheme": "tokyo-night",
  "workbench.appearance": "system",
  "window.glass": 0.74,
  "keybindings": {
    "toggle-sidebar": "cmd+shift+e"
  }
}
```

Available themes: `one`, `github`, `xcode`, `solarized`, `catppuccin`, `gruvbox`, `tokyo-night`, `rose-pine`, `dracula` and `pierre`.

Command ids for `keybindings` are shown next to each entry in the command palette.

## Project structure

```
src/                 React frontend
  components/        UI: file tree, tabs, panels, palette, previews
  editor/            CodeMirror setup, themes, completion
  lsp/               Language server client
  terminal/          xterm.js terminal manager
  lib/               File system, settings, persistence helpers
src-tauri/src/       Rust backend
  lsp.rs             Language server discovery and process management
  pty.rs             Terminal PTY sessions
  git.rs             Git integration
  search.rs          Project-wide search
  format.rs          Prettier and ESLint formatting
  settings.rs        Settings file handling
scripts/release.sh   Build and install script
```

## Contributing

Issues and pull requests are welcome. For larger changes, please open an issue first to discuss what you'd like to change.

## License

[MIT](LICENSE)
