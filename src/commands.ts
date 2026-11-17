import { openSearchPanel, selectNextOccurrence, selectSelectionMatches } from "@codemirror/search";
import { foldAll, unfoldAll } from "@codemirror/language";
import {
  addCursorAbove,
  addCursorBelow,
  copyLineDown,
  copyLineUp,
  cursorMatchingBracket,
  deleteTrailingWhitespace,
  lineComment,
  lineUncomment,
  moveLineDown,
  moveLineUp,
  selectAll,
  selectLine,
  toggleBlockComment,
  toggleComment,
} from "@codemirror/commands";
import { nextDiagnostic, previousDiagnostic } from "@codemirror/lint";
import { findReferences, jumpToDefinition, renameSymbol } from "@codemirror/lsp-client";
import type { EditorView } from "@codemirror/view";
import {
  clearRecents,
  closeAll,
  closeFolder,
  closeSaved,
  closeTab,
  collapseAll,
  copyPath,
  deleteSelected,
  cycleTab,
  focusGroup,
  focusGroupStep,
  formatDocument,
  gitActions,
  moveEditorToGroup,
  navigate,
  newFile,
  newFolder,
  openDiff,
  openFileDialog,
  openFolder,
  openLog,
  openSettings,
  organizeImports,
  quickFix,
  reopenClosedTab,
  restartLanguageServers,
  revealActive,
  revertFile,
  saveAll,
  saveAs,
  saveFile,
  selectTab,
  setFontSize,
  setGlass,
  showExplorer,
  showGit,
  showSearch,
  toast,
  toggleMarkdownPreview,
  toggleProblems,
  togglePanel,
  toggleSidebar,
  toggleSplit,
  toggleWrap,
} from "./actions";
import { editorCommands, session } from "./editor/session";
import { clearTerminal, closeTerminal, createTerminal, toggleTerminal } from "./terminal/manager";
import { rerunTask, runActiveFile, runSelection } from "./tasks";
import { get, set } from "./store";
import { eventShortcut, normalizeShortcut, settings, shortcutLabel } from "./lib/settings";
import { isDiffPath } from "./lib/diffpath";

export type Command = { id: string; label: string; run: () => void; hidden?: boolean };

// "editorFocus" only fires while the editor itself has focus, for keys that mean
// something else elsewhere (⌥↑ in the terminal, arrows in the file tree).
type Context = "editor" | "terminal" | "field" | "explorer" | "other";
type When = Context | "editorFocus";
type Binding = { key: string; command: string; when?: When };

const withView = (fn: (v: NonNullable<typeof session.view>) => void) => () => {
  const v = session.view;
  if (v && get().active && !isDiffPath(get().active!)) fn(v);
};

// Runs a CodeMirror command against the focused editor, then returns focus to it
// so commands picked from the menu bar or the palette behave like their shortcuts.
const cm = (fn: (v: EditorView) => boolean | void) =>
  withView((v) => {
    fn(v);
    v.focus();
  });

const lspCommand = (fn: (v: EditorView) => boolean, name: string) =>
  withView((v) => {
    if (!fn(v)) toast(`${name} needs a language server for this file`);
  });

function activeFile() {
  const a = get().active;
  return a && !isDiffPath(a) ? a : null;
}

const isMarkdown = (p: string | null) => !!p && /\.(md|markdown|mdx)$/i.test(p);

export const commands: Command[] = [
  { id: "commands", label: "Show All Commands", run: () => set({ palette: "commands" }) },
  { id: "quick-open", label: "Go to File…", run: () => set({ palette: "files" }) },
  { id: "recent", label: "Open Recent…", run: () => set({ palette: "recent" }) },
  { id: "search", label: "Search in Project", run: () => showSearch() },
  { id: "replace-in-files", label: "Replace in Files", run: () => showSearch(true) },
  { id: "explorer", label: "Show Explorer", run: showExplorer },
  { id: "focus-sidebar", label: "Focus Side Bar", run: showExplorer },
  { id: "git", label: "Show Source Control", run: showGit },
  { id: "toggle-sidebar", label: "Toggle Sidebar", run: toggleSidebar },
  { id: "panel", label: "Toggle Panel", run: togglePanel },
  { id: "toggle-status-bar", label: "Toggle Status Bar", run: () => set((s) => ({ statusBar: !s.statusBar })) },
  { id: "terminal", label: "Toggle Terminal", run: toggleTerminal },
  { id: "new-terminal", label: "New Terminal", run: () => createTerminal() },
  { id: "clear-terminal", label: "Terminal: Clear", run: clearTerminal },
  { id: "kill-terminal", label: "Terminal: Kill the Active Terminal", run: () => get().activeTerminal != null && closeTerminal(get().activeTerminal!) },
  { id: "problems", label: "Toggle Problems", run: toggleProblems },
  { id: "open-folder", label: "Open Folder…", run: openFolder },
  { id: "open-file", label: "Open File…", run: openFileDialog },
  { id: "close-folder", label: "Close Folder", run: closeFolder },
  { id: "new-file", label: "New File", run: () => newFile() },
  { id: "new-folder", label: "New Folder", run: () => newFolder() },
  { id: "save", label: "Save", run: () => saveFile() },
  { id: "save-without-formatting", label: "Save without Formatting", run: () => saveFile(undefined, { format: false }) },
  { id: "save-all", label: "Save All", run: saveAll },
  { id: "save-as", label: "Save As…", run: saveAs },
  { id: "revert-file", label: "Revert File", run: revertFile },
  { id: "clear-recents", label: "Clear Recently Opened", run: clearRecents },
  { id: "close-tab", label: "Close Editor", run: () => closeTab() },
  { id: "close-all", label: "Close All Editors", run: closeAll },
  { id: "close-saved", label: "Close Saved Editors", run: closeSaved },
  { id: "reopen-closed", label: "Reopen Closed Editor", run: reopenClosedTab },
  { id: "next-tab", label: "Next Editor", run: () => cycleTab(1) },
  { id: "prev-tab", label: "Previous Editor", run: () => cycleTab(-1) },
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ id: `open-editor-${n}`, label: `Open Editor at Index ${n}`, hidden: true, run: () => selectTab(n) })),
  { id: "open-editor-last", label: "Open Last Editor", hidden: true, run: () => selectTab(0) },
  { id: "split", label: "Split Editor", run: toggleSplit },
  { id: "focus-group-1", label: "Focus First Editor Group", run: () => focusGroup(1) },
  { id: "focus-group-2", label: "Focus Second Editor Group", run: () => focusGroup(2) },
  { id: "focus-left-group", label: "Focus Left Editor Group", run: () => focusGroupStep(-1) },
  { id: "focus-right-group", label: "Focus Right Editor Group", run: () => focusGroupStep(1) },
  { id: "move-editor-left", label: "Move Editor into Left Group", run: () => moveEditorToGroup(-1) },
  { id: "move-editor-right", label: "Move Editor into Right Group", run: () => moveEditorToGroup(1) },
  { id: "back", label: "Go Back", run: () => navigate(-1) },
  { id: "forward", label: "Go Forward", run: () => navigate(1) },
  { id: "goto-line", label: "Go to Line…", run: () => activeFile() && set({ palette: "line" }) },
  { id: "symbols", label: "Go to Symbol in File…", run: () => activeFile() && set({ palette: "symbols" }) },
  { id: "workspace-symbols", label: "Go to Symbol in Workspace…", run: () => set({ palette: "workspace-symbols" }) },
  { id: "quick-fix", label: "Quick Fix…", run: quickFix },
  { id: "organize-imports", label: "Organize Imports", run: organizeImports },
  { id: "format", label: "Format Document", run: () => formatDocument() },
  { id: "trim-whitespace", label: "Trim Trailing Whitespace", run: withView((v) => deleteTrailingWhitespace(v)) },
  { id: "add-line-comment", label: "Add Line Comment", run: withView((v) => lineComment(v)) },
  { id: "remove-line-comment", label: "Remove Line Comment", run: withView((v) => lineUncomment(v)) },
  { id: "find", label: "Find", run: withView((v) => openSearchPanel(v)) },
  { id: "replace", label: "Replace", run: cm(editorCommands.openReplace) },
  { id: "toggle-line-comment", label: "Toggle Line Comment", run: cm(toggleComment) },
  { id: "toggle-block-comment", label: "Toggle Block Comment", run: cm(toggleBlockComment) },
  { id: "select-all", label: "Select All", run: cm(selectAll) },
  { id: "expand-selection", label: "Expand Selection", run: cm(editorCommands.expandSelection) },
  { id: "shrink-selection", label: "Shrink Selection", run: cm(editorCommands.shrinkSelection) },
  { id: "copy-line-up", label: "Copy Line Up", run: cm(copyLineUp) },
  { id: "copy-line-down", label: "Copy Line Down", run: cm(copyLineDown) },
  { id: "move-line-up", label: "Move Line Up", run: cm(moveLineUp) },
  { id: "move-line-down", label: "Move Line Down", run: cm(moveLineDown) },
  { id: "add-cursor-above", label: "Add Cursor Above", run: cm(addCursorAbove) },
  { id: "add-cursor-below", label: "Add Cursor Below", run: cm(addCursorBelow) },
  { id: "cursors-line-ends", label: "Add Cursors to Line Ends", run: cm(editorCommands.cursorsAtLineEnds) },
  { id: "add-next-occurrence", label: "Add Next Occurrence", run: cm(selectNextOccurrence) },
  { id: "select-all-occurrences", label: "Select All Occurrences", run: cm(selectSelectionMatches) },
  { id: "select-line", label: "Select Line", run: cm(selectLine) },
  { id: "go-to-definition", label: "Go to Definition", run: lspCommand(jumpToDefinition, "Go to Definition") },
  { id: "find-references", label: "Go to References", run: lspCommand(findReferences, "Go to References") },
  { id: "rename-symbol", label: "Rename Symbol", run: lspCommand(renameSymbol, "Rename Symbol") },
  { id: "go-to-bracket", label: "Go to Bracket", run: cm(cursorMatchingBracket) },
  { id: "next-problem", label: "Go to Next Problem", run: cm(nextDiagnostic) },
  { id: "prev-problem", label: "Go to Previous Problem", run: cm(previousDiagnostic) },
  { id: "run-task", label: "Run Task…", run: () => (get().root ? set({ palette: "tasks" }) : toast("Open a folder to run its tasks")) },
  { id: "rerun-task", label: "Rerun Last Task", run: rerunTask },
  { id: "run-active-file", label: "Run Active File", run: runActiveFile },
  { id: "run-selection", label: "Run Selected Text in Terminal", run: runSelection },
  { id: "restart-lsp", label: "Restart Language Servers", run: restartLanguageServers },
  { id: "fold-all", label: "Fold All", run: withView((v) => foldAll(v)) },
  { id: "unfold-all", label: "Unfold All", run: withView((v) => unfoldAll(v)) },
  { id: "toggle-wrap", label: "Toggle Word Wrap", run: toggleWrap },
  { id: "md-preview", label: "Markdown: Toggle Preview", run: () => toggleMarkdownPreview() },
  { id: "md-preview-side", label: "Markdown: Open Preview to the Side", run: () => isMarkdown(activeFile()) && !get().mdPreview[activeFile()!] && toggleMarkdownPreview() },
  { id: "settings", label: "Open Settings (JSON)", run: () => openSettings() },
  { id: "keyboard-shortcuts", label: "Open Keyboard Shortcuts", run: () => openSettings("keybindings") },
  { id: "theme", label: "Change Color Theme…", run: () => set({ palette: "theme" }) },
  { id: "font", label: "Change Editor Font…", run: () => set({ palette: "font" }) },
  { id: "zoom-in", label: "Increase Font Size", run: () => setFontSize(get().fontSize + 1) },
  { id: "zoom-out", label: "Decrease Font Size", run: () => setFontSize(get().fontSize - 1) },
  { id: "zoom-reset", label: "Reset Font Size", run: () => setFontSize("reset") },
  { id: "glass-more", label: "Increase Transparency", run: () => setGlass(get().glass - 0.06) },
  { id: "glass-less", label: "Decrease Transparency", run: () => setGlass(get().glass + 0.06) },
  { id: "glass-reset", label: "Reset Transparency", run: () => setGlass(0.74) },
  { id: "collapse-tree", label: "Collapse Folders in Explorer", run: collapseAll },
  { id: "reveal", label: "Reveal in Finder", run: revealActive },
  { id: "delete-file", label: "Delete Selected Files", run: deleteSelected },
  { id: "copy-path", label: "Copy Path of Active File", run: () => activeFile() && copyPath(activeFile()!) },
  { id: "copy-rel-path", label: "Copy Relative Path of Active File", run: () => activeFile() && copyPath(activeFile()!, true) },
  { id: "git-diff", label: "Git: Open Changes", run: () => activeFile() && openDiff(activeFile()!) },
  { id: "git-stage", label: "Git: Stage File", run: () => activeFile() && gitActions.stage([activeFile()!]) },
  { id: "git-unstage", label: "Git: Unstage File", run: () => activeFile() && gitActions.unstage([activeFile()!]) },
  { id: "git-commit", label: "Git: Commit", run: showGit },
  { id: "git-pull", label: "Git: Pull", run: gitActions.pull },
  { id: "git-push", label: "Git: Push", run: gitActions.push },
  { id: "git-sync", label: "Git: Sync", run: gitActions.sync },
  { id: "git-fetch", label: "Git: Fetch", run: gitActions.fetch },
  { id: "log", label: "Open Log File", run: openLog },
  { id: "reload", label: "Reload Window", run: () => window.location.reload() },
];

const byId = new Map(commands.map((c) => [c.id, c]));

export const defaultBindings: Binding[] = [
  { key: "cmd+shift+p", command: "commands" },
  { key: "f1", command: "commands" },
  { key: "cmd+p", command: "quick-open" },
  { key: "ctrl+r", command: "recent" },
  { key: "cmd+shift+f", command: "search" },
  { key: "cmd+shift+h", command: "replace-in-files" },
  { key: "cmd+shift+e", command: "explorer" },
  { key: "cmd+0", command: "focus-sidebar" },
  { key: "ctrl+shift+g", command: "git" },
  { key: "cmd+b", command: "toggle-sidebar" },
  { key: "cmd+j", command: "panel" },
  { key: "ctrl+`", command: "terminal" },
  { key: "ctrl+shift+`", command: "new-terminal" },
  { key: "cmd+k", command: "clear-terminal", when: "terminal" },
  { key: "cmd+shift+m", command: "problems" },
  { key: "cmd+o", command: "open-folder" },
  { key: "cmd+k cmd+o", command: "open-folder" },
  { key: "cmd+alt+o", command: "open-file" },
  { key: "cmd+k f", command: "close-folder" },
  { key: "cmd+n", command: "new-file" },
  { key: "cmd+shift+n", command: "new-folder" },
  { key: "cmd+s", command: "save" },
  { key: "cmd+k s", command: "save-without-formatting" },
  { key: "cmd+alt+s", command: "save-all" },
  { key: "cmd+w", command: "kill-terminal", when: "terminal" },
  { key: "cmd+w", command: "close-tab" },
  { key: "cmd+k cmd+w", command: "close-all" },
  { key: "cmd+k u", command: "close-saved" },
  { key: "cmd+shift+t", command: "reopen-closed" },
  { key: "ctrl+tab", command: "next-tab" },
  { key: "ctrl+shift+tab", command: "prev-tab" },
  { key: "cmd+alt+right", command: "next-tab" },
  { key: "cmd+alt+left", command: "prev-tab" },
  { key: "cmd+shift+]", command: "next-tab" },
  { key: "cmd+shift+[", command: "prev-tab" },
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ key: `ctrl+${n}`, command: `open-editor-${n}` })),
  { key: "ctrl+0", command: "open-editor-last" },
  { key: "cmd+\\", command: "split" },
  { key: "cmd+1", command: "focus-group-1" },
  { key: "cmd+2", command: "focus-group-2" },
  { key: "cmd+k cmd+left", command: "focus-left-group" },
  { key: "cmd+k cmd+right", command: "focus-right-group" },
  { key: "ctrl+cmd+left", command: "move-editor-left" },
  { key: "ctrl+cmd+right", command: "move-editor-right" },
  { key: "ctrl+-", command: "back" },
  { key: "ctrl+shift+-", command: "forward" },
  { key: "ctrl+g", command: "goto-line" },
  { key: "cmd+shift+o", command: "symbols" },
  { key: "cmd+t", command: "workspace-symbols" },
  { key: "cmd+.", command: "quick-fix", when: "editor" },
  { key: "shift+alt+o", command: "organize-imports", when: "editor" },
  { key: "shift+alt+f", command: "format", when: "editor" },
  { key: "cmd+k cmd+x", command: "trim-whitespace", when: "editor" },
  { key: "cmd+k cmd+c", command: "add-line-comment", when: "editor" },
  { key: "cmd+k cmd+u", command: "remove-line-comment", when: "editor" },
  { key: "cmd+k cmd+0", command: "fold-all", when: "editor" },
  { key: "cmd+k cmd+j", command: "unfold-all", when: "editor" },
  { key: "alt+z", command: "toggle-wrap" },
  { key: "cmd+shift+v", command: "md-preview" },
  { key: "cmd+k v", command: "md-preview-side" },
  { key: "cmd+,", command: "settings" },
  { key: "cmd+k cmd+s", command: "keyboard-shortcuts" },
  { key: "cmd+k cmd+t", command: "theme" },
  { key: "cmd+=", command: "zoom-in" },
  { key: "cmd+shift+=", command: "zoom-in" },
  { key: "cmd+-", command: "zoom-out" },
  { key: "cmd+numpad0", command: "zoom-reset" },
  { key: "cmd+k p", command: "copy-path" },
  { key: "cmd+alt+c", command: "copy-path" },
  { key: "cmd+alt+shift+c", command: "copy-rel-path" },
  { key: "cmd+k r", command: "reveal" },
  { key: "cmd+backspace", command: "delete-file", when: "explorer" },
  { key: "cmd+shift+s", command: "save-as" },
  { key: "cmd+f", command: "find", when: "editor" },
  { key: "cmd+alt+f", command: "replace", when: "editor" },
  { key: "cmd+/", command: "toggle-line-comment", when: "editorFocus" },
  { key: "shift+alt+a", command: "toggle-block-comment", when: "editorFocus" },
  { key: "ctrl+shift+cmd+right", command: "expand-selection", when: "editorFocus" },
  { key: "ctrl+shift+cmd+left", command: "shrink-selection", when: "editorFocus" },
  { key: "shift+alt+up", command: "copy-line-up", when: "editorFocus" },
  { key: "shift+alt+down", command: "copy-line-down", when: "editorFocus" },
  { key: "alt+up", command: "move-line-up", when: "editorFocus" },
  { key: "alt+down", command: "move-line-down", when: "editorFocus" },
  { key: "cmd+alt+up", command: "add-cursor-above", when: "editorFocus" },
  { key: "cmd+alt+down", command: "add-cursor-below", when: "editorFocus" },
  { key: "shift+alt+i", command: "cursors-line-ends", when: "editorFocus" },
  { key: "cmd+d", command: "add-next-occurrence", when: "editorFocus" },
  { key: "cmd+shift+l", command: "select-all-occurrences", when: "editorFocus" },
  { key: "cmd+l", command: "select-line", when: "editorFocus" },
  { key: "f12", command: "go-to-definition", when: "editorFocus" },
  { key: "shift+f12", command: "find-references", when: "editorFocus" },
  { key: "f2", command: "rename-symbol", when: "editorFocus" },
  { key: "cmd+shift+\\", command: "go-to-bracket", when: "editorFocus" },
  { key: "f8", command: "next-problem", when: "editorFocus" },
  { key: "shift+f8", command: "prev-problem", when: "editorFocus" },
  { key: "cmd+shift+b", command: "run-task" },
];

const normalizeChord = (spec: string) => spec.trim().split(/\s+/).map(normalizeShortcut).join(" ");

let boundFrom: unknown = null;
let bindings: Binding[] = [];

function activeBindings() {
  if (boundFrom !== settings) {
    boundFrom = settings;
    const custom: Binding[] = [];
    const overridden = new Set<string>();
    for (const [id, spec] of Object.entries(settings.keybindings ?? {})) {
      if (typeof spec !== "string") continue;
      overridden.add(id);
      if (spec.trim()) custom.push({ key: normalizeChord(spec), command: id });
    }
    bindings = [...custom, ...defaultBindings.filter((b) => !overridden.has(b.command)).map((b) => ({ ...b, key: normalizeChord(b.key) }))];
  }
  return bindings;
}

export function commandShortcut(c: Command) {
  const b = activeBindings().find((x) => x.command === c.id);
  return b ? b.key.split(" ").map(shortcutLabel).join(" ") : undefined;
}

export function bindingLabel(id: string) {
  const c = byId.get(id);
  return c ? commandShortcut(c) : undefined;
}

function contextOf(target: HTMLElement | null): Context {
  if (target?.closest?.(".terminal-panel")) return "terminal";
  if (target?.closest?.(".cm-editor")) return target.closest(".cm-panels") ? "field" : "editor";
  if (target?.closest?.("input, textarea")) return "field";
  if (target?.closest?.(".tree")) return "explorer";
  return "other";
}

let pending: string | null = null;

function matches(b: Binding, combo: string, ctx: Context) {
  if (b.key !== combo) return false;
  if (!b.when) return true;
  if (b.when === "editor") return ctx === "editor" || (ctx === "other" && !!activeFile());
  if (b.when === "editorFocus") return ctx === "editor";
  return b.when === ctx;
}

export function commandLabel(id: string) {
  return byId.get(id)?.label ?? id;
}

// Shortcuts are matched by physical key, but macOS menus match punctuation by the
// character it types, which moves between keyboard layouts (⌘/ on a Spanish
// keyboard shows as ⌘'). Only punctuation that sits on the same key on common
// layouts goes into the menu; the rest still works through the keydown handler.
const acceleratorKeys: Record<string, string> = {
  ",": "Comma",
  ".": "Period",
};
const acceleratorMods: Record<string, string> = { cmd: "Cmd", ctrl: "Ctrl", alt: "Alt", shift: "Shift" };

// The native menu only gets single-stroke ⌘ shortcuts that mean the same thing
// everywhere. Keys without ⌘ (⌃R, ⌥↑, F8…) must still reach the terminal and
// text fields, and ⌘K starts chords, so those are left to the keydown handler.
export function commandAccelerator(id: string): string | undefined {
  const list = activeBindings();
  const b = list.find((x) => x.command === id);
  if (!b || b.key.includes(" ") || b.when === "terminal" || b.when === "field") return undefined;
  const parts = b.key.split("+");
  if (!parts.includes("cmd") || list.some((x) => x.key.startsWith(b.key + " "))) return undefined;
  const key = parts.pop()!;
  if (key.length === 1 && !/[a-z0-9]/.test(key) && !acceleratorKeys[key]) return undefined;
  const name = acceleratorKeys[key] ?? (key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1));
  return [...parts.map((m) => acceleratorMods[m] ?? m), name].join("+");
}

// A shortcut handled here also reaches the native menu when the menu has the same
// accelerator. Whichever side runs first wins, so the command never runs twice.
let lastShortcutAt = -Infinity;

export function runMenuCommand(id: string) {
  if (performance.now() - lastShortcutAt < 300) return;
  byId.get(id)?.run();
}

export function installShortcuts() {
  const handler = (e: KeyboardEvent) => {
    if (["Shift", "Meta", "Control", "Alt", "CapsLock"].includes(e.key)) return;
    const s = get();
    if (s.palette || s.dialog || s.menu) {
      if (e.metaKey && e.code === "KeyP") e.preventDefault();
      pending = null;
      return;
    }
    const ctx = contextOf(e.target as HTMLElement | null);
    const combo = eventShortcut(e);
    const list = activeBindings();

    const run = (id: string) => {
      e.preventDefault();
      e.stopPropagation();
      lastShortcutAt = performance.now();
      byId.get(id)?.run();
    };

    if (pending) {
      const chord = `${pending} ${combo}`;
      pending = null;
      set({ toast: null });
      const hit = list.find((b) => matches(b, chord, ctx));
      e.preventDefault();
      e.stopPropagation();
      if (hit) run(hit.command);
      else toast(`(${chord.split(" ").map(shortcutLabel).join(" ")}) is not a command`);
      return;
    }

    const hasCmd = e.metaKey;
    if (ctx === "terminal" && !hasCmd && !/^ctrl\+(shift\+)?`$/.test(combo) && !/^f\d+$/.test(combo)) return;
    if (ctx === "field" && !hasCmd && !/^f\d+$/.test(combo)) return;

    const direct = list.find((b) => matches(b, combo, ctx));
    if (direct) return run(direct.command);

    if (list.some((b) => b.key.startsWith(combo + " "))) {
      e.preventDefault();
      e.stopPropagation();
      pending = combo;
      set({ toast: { text: `(${shortcutLabel(combo)}) was pressed. Waiting for second key of chord…`, id: Date.now() } });
      return;
    }
  };
  window.addEventListener("keydown", handler, true);
  const onContext = (e: MouseEvent) => {
    if (!(e.target as HTMLElement).closest(".cm-content, input, textarea, .xterm")) e.preventDefault();
  };
  window.addEventListener("contextmenu", onContext);
  return () => {
    window.removeEventListener("keydown", handler, true);
    window.removeEventListener("contextmenu", onContext);
  };
}
