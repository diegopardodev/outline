import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { basename, dirname, errorText, fs, git as gitApi, join, relative, type OpenRequest, type ReplaceTarget } from "./lib/fs";
import { load as persistLoad, save as persistSave } from "./lib/persist";
import { session } from "./editor/session";
import { setFolderCustomizations } from "./lib/icons";
import { lsp, setApplyEditHandler, setDisplayHandler, setServerExitHandler, uriToPath, type CodeAction, type WorkspaceEdit } from "./lsp/client";
import { isImage } from "./lib/media";
import { diffPath, isDiffPath, parseDiffPath, type DiffSide } from "./lib/diffpath";
import { appearance, eslintFixOnSave, formatOnSave, loadSettings, settingsPath } from "./lib/settings";
import { applyColorTheme } from "./editor/themes";
import { get, set, useStore, emptyGit, type SearchOptions, type Tab } from "./store";

let fileCache: { root: string; files: string[] } | null = null;
let toastTimer: number | undefined;

export function toast(text: string) {
  window.clearTimeout(toastTimer);
  set({ toast: { text, id: Date.now() } });
  toastTimer = window.setTimeout(() => set({ toast: null }), 2600);
}

let flushPersist = () => {};

function startPersistence() {
  const write = (s: ReturnType<typeof get>) =>
    persistSave({
      root: s.root,
      tabs: s.tabs.filter((t) => t.kind !== "diff").map((t) => t.path),
      active: s.active && !isDiffPath(s.active) ? s.active : null,
      sidebarWidth: s.sidebarWidth,
      sidebarVisible: s.sidebarVisible,
      fontSize: s.fontSize,
      editorFont: s.editorFont,
      colorTheme: s.colorTheme,
      glass: s.glass,
      wrap: s.wrap,
      recents: s.recents,
      expanded: Object.keys(s.expanded),
      terminalHeight: s.terminalHeight,
      statusBar: s.statusBar,
      prefsVersion: 3,
    });
  let timer: number | undefined;
  useStore.subscribe((s) => {
    if (!s.ready) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => write(s), 300);
  });
  flushPersist = () => {
    window.clearTimeout(timer);
    const s = get();
    if (s.ready) write(s);
  };
}

export async function loadDir(path: string) {
  try {
    const entries = await fs.readDir(path);
    set((s) => ({ tree: { ...s.tree, [path]: entries } }));
  } catch {
    set((s) => {
      const tree = { ...s.tree };
      delete tree[path];
      const expanded = { ...s.expanded };
      delete expanded[path];
      return { tree, expanded };
    });
  }
}

export async function toggleDir(path: string) {
  const { expanded, tree } = get();
  if (expanded[path]) {
    const next = { ...expanded };
    delete next[path];
    set({ expanded: next, selected: path, selection: [path], selectionAnchor: null });
    return;
  }
  set({ expanded: { ...expanded, [path]: true }, selected: path, selection: [path], selectionAnchor: null });
  if (!tree[path]) await loadDir(path);
}

export function collapseAll() {
  set({ expanded: {} });
}

let gitTimer: number | undefined;
export function refreshGit(delay = 0) {
  window.clearTimeout(gitTimer);
  gitTimer = window.setTimeout(async () => {
    const { root } = get();
    if (!root) return set({ git: emptyGit });
    try {
      const status = await fs.git(root);
      const changes: Record<string, string> = {};
      const dirs: Record<string, true> = {};
      for (const [path, code] of status.changes) {
        changes[path] = code;
        let d = dirname(path);
        while (d.length > 1 && d.startsWith(root)) {
          dirs[d] = true;
          d = dirname(d);
        }
      }
      if (get().root !== root) return;
      set((s) => ({
        git: {
          ...s.git,
          branch: status.branch,
          top: status.top,
          upstream: status.upstream,
          ahead: status.ahead,
          behind: status.behind,
          changes,
          dirs,
          entries: status.entries,
        },
      }));
      refreshBases();
    } catch (e) {
      console.warn("git status failed", e);
    }
  }, delay);
}

async function refreshBases(only?: string) {
  const { root, git, tabs } = get();
  if (!root) return;
  const byPath = new Map(git.entries.map((e) => [e.path, e]));
  for (const t of tabs) {
    if (t.kind || !session.has(t.path) || (only && t.path !== only)) continue;
    if (!git.top || !t.path.startsWith(git.top + "/")) {
      session.setBase(t.path, null);
      continue;
    }
    const entry = byPath.get(t.path);
    if (!entry || entry.y === " ") session.setBase(t.path, null, true);
    else if (entry.x === "?") session.setBase(t.path, null);
    else session.setBase(t.path, await gitApi.show(root, t.path, "index").catch(() => null));
  }
}

async function confirmDiscard(tabs: Tab[], title: string): Promise<boolean> {
  const dirty = tabs.filter((t) => t.dirty);
  if (!dirty.length) return true;
  return new Promise((resolve) => {
    const names = dirty.map((t) => t.name).join(", ");
    set({
      dialog: {
        kind: "confirm",
        title,
        message: `You have unsaved changes in ${names}.`,
        buttons: [
          { label: "Cancel", kind: "plain", run: () => resolve(false) },
          { label: "Discard", kind: "danger", run: () => resolve(true) },
          {
            label: dirty.length === 1 ? "Save" : "Save All",
            kind: "primary",
            run: async () => {
              for (const t of dirty) await saveFile(t.path);
              resolve(!get().tabs.some((t) => t.dirty));
            },
          },
        ],
      },
    });
  });
}

export async function setRoot(path: string, restore?: { tabs: string[]; active: string | null }) {
  try {
    await fs.readDir(path);
  } catch {
    set((s) => ({ recents: s.recents.filter((r) => r !== path), root: s.root === path ? null : s.root }));
    toast("That folder no longer exists");
    return;
  }
  const { tabs, root } = get();
  if (root && root !== path && !(await confirmDiscard(tabs, "Switch folders?"))) return;
  for (const t of tabs) session.close(t.path);
  session.show(null);
  if (root !== path) lsp.stopAll();
  fileCache = null;
  const recents = [path, ...get().recents.filter((r) => r !== path)].slice(0, 8);
  const keepExpanded = root === path || restore ? get().expanded : {};
  set((s) => ({
    root: path,
    tree: {},
    tabs: [],
    active: null,
    selected: null,
    selection: [],
    recents,
    expanded: keepExpanded,
    history: { stack: [], index: -1 },
    search: { ...s.search, result: null, error: null },
    git: emptyGit,
    split: null,
    problems: {},
  }));
  await loadDir(path);
  await Promise.all(Object.keys(keepExpanded).filter((p) => p.startsWith(path + "/")).map(loadDir));
  fs.watch(path).catch(() => {});
  refreshGit();
  if (restore) {
    for (const t of restore.tabs) await openFile(t, { quiet: true, activate: false });
    const target = restore.active && get().tabs.some((t) => t.path === restore.active) ? restore.active : get().tabs[0]?.path;
    if (target) activate(target);
  }
}

export async function openFolder() {
  const picked = await openDialog({ directory: true, multiple: false, title: "Open Folder" });
  if (typeof picked === "string") await setRoot(picked);
}

export async function openFileDialog() {
  const picked = await openDialog({ directory: false, multiple: false, title: "Open File", defaultPath: get().root ?? undefined });
  if (typeof picked === "string") await openFile(picked);
}

export async function openFile(path: string, opts: { quiet?: boolean; activate?: boolean } = {}) {
  const { tabs } = get();
  if (tabs.some((t) => t.path === path)) {
    if (opts.activate !== false) activate(path);
    return true;
  }
  try {
    const diff = parseDiffPath(path);
    const image = !diff && isImage(path);
    if (!image && !diff) session.open(path, await fs.readFile(path));
    const name = diff ? `${basename(diff.path)} (${diff.side === "staged" ? "Index" : "Working Tree"})` : basename(path);
    const kind = diff ? ("diff" as const) : image ? ("image" as const) : undefined;
    const tab: Tab = { path, name, dirty: false, ...(kind ? { kind } : {}) };
    set((s) => {
      const i = s.tabs.findIndex((t) => t.path === s.active);
      const next = [...s.tabs];
      next.splice(i < 0 ? next.length : i + 1, 0, tab);
      return { tabs: next };
    });
    if (opts.activate !== false) activate(path);
    if (!kind) refreshBases(path);
    return true;
  } catch (e) {
    if (!opts.quiet) toast(errorText(e));
    return false;
  }
}

export function showIn(pane: 0 | 1, path: string | null) {
  const tab = path ? get().tabs.find((t) => t.path === path) : undefined;
  const editorPath = tab && !tab.kind ? tab.path : null;
  if (pane === 1) session.showSecondary(editorPath);
  else session.show(editorPath);
}

export function activate(path: string | null, fromHistory = false) {
  const pane = get().split?.focus ?? 0;
  set((s) => {
    let history = s.history;
    if (path && !fromHistory && s.history.stack[s.history.index] !== path) {
      const stack = [...s.history.stack.slice(0, s.history.index + 1), path].slice(-50);
      history = { stack, index: stack.length - 1 };
    }
    const real = path ? parseDiffPath(path)?.path ?? path : null;
    const split = s.split ? { ...s.split, [pane === 1 ? "right" : "left"]: path } : null;
    return { active: path, selected: real ?? s.selected, selection: real ? [] : s.selection, history, split };
  });
  showIn(pane, path);
}

export function focusPane(pane: 0 | 1, focusEditor = true) {
  const s = get();
  if (!s.split) return;
  const path = pane === 1 ? s.split.right : s.split.left;
  if (s.split.focus !== pane || s.active !== path) set({ split: { ...s.split, focus: pane }, active: path });
  session.setFocused(pane);
  if (focusEditor) session.focus();
}

export function toggleSplit() {
  const s = get();
  if (s.split) {
    const keep = s.split.focus === 1 ? s.split.right : s.split.left;
    set({ split: null, active: keep });
    session.setFocused(0);
    showIn(0, keep);
    return;
  }
  if (!s.active) return;
  set({ split: { left: s.active, right: s.active, focus: 1 } });
}

export function openToSide(path: string) {
  const s = get();
  if (!s.split) {
    set({ split: { left: s.active, right: null, focus: 1 } });
    requestAnimationFrame(() => openFile(path));
    return;
  }
  focusPane(1, false);
  openFile(path);
}

export async function togglePreview(path: string) {
  const tab = get().tabs.find((t) => t.path === path);
  if (!tab) return;
  if (tab.kind === "image") {
    if (!session.has(path)) {
      try {
        session.open(path, await fs.readFile(path));
      } catch (e) {
        toast(errorText(e));
        return;
      }
    }
    set((s) => ({ tabs: s.tabs.map((t) => (t.path === path ? { path: t.path, name: t.name, dirty: t.dirty } : t)) }));
  } else if (isImage(path)) {
    set((s) => ({ tabs: s.tabs.map((t) => (t.path === path ? { ...t, kind: "image" as const } : t)) }));
  }
  if (get().active === path) activate(path, true);
}

export function navigate(step: -1 | 1) {
  const { history, tabs } = get();
  let i = history.index + step;
  while (i >= 0 && i < history.stack.length) {
    const path = history.stack[i];
    if (tabs.some((t) => t.path === path)) {
      set({ history: { ...history, index: i } });
      activate(path, true);
      return;
    }
    i += step;
  }
}

export async function closeTab(path?: string) {
  const target = path ?? get().active;
  if (!target) return;
  const { tabs, active } = get();
  const tab = tabs.find((t) => t.path === target);
  if (!tab) return;
  if (tab.dirty && !(await confirmDiscard([tab], `Close ${tab.name}?`))) return;
  rememberClosed([tab]);
  const i = tabs.findIndex((t) => t.path === target);
  const rest = tabs.filter((t) => t.path !== target);
  session.close(target);
  set({ tabs: rest });
  const next = rest[Math.min(i, rest.length - 1)]?.path ?? null;
  const split = get().split;
  if (split) {
    const left = split.left === target ? next : split.left;
    const right = split.right === target ? next : split.right;
    if (!left || !right) {
      const keep = left ?? right;
      set({ split: null, active: keep });
      session.setFocused(0);
      showIn(0, keep);
      return;
    }
    set({ split: { ...split, left, right }, active: split.focus === 1 ? right : left });
    if (split.left === target) showIn(0, left);
    if (split.right === target) showIn(1, right);
    return;
  }
  if (active === target) activate(next);
}

let closedTabs: string[] = [];

function rememberClosed(tabs: Tab[]) {
  const paths = tabs.filter((t) => t.kind !== "diff").map((t) => t.path);
  closedTabs = [...paths.reverse(), ...closedTabs.filter((p) => !paths.includes(p))].slice(0, 30);
}

export async function reopenClosedTab() {
  while (closedTabs.length) {
    const path = closedTabs.shift()!;
    if (get().tabs.some((t) => t.path === path)) continue;
    if (await openFile(path, { quiet: true })) return;
  }
}

export async function closeSaved() {
  const saved = get().tabs.filter((t) => !t.dirty);
  for (const t of saved) await closeTab(t.path);
}

export async function closeFolder() {
  const { tabs, root } = get();
  if (!root) return;
  if (!(await confirmDiscard(tabs, "Close folder?"))) return;
  for (const t of tabs) session.close(t.path);
  session.show(null);
  lsp.stopAll();
  fileCache = null;
  set((s) => ({
    root: null,
    tree: {},
    tabs: [],
    active: null,
    selected: null,
    selection: [],
    split: null,
    problems: {},
    git: emptyGit,
    history: { stack: [], index: -1 },
    search: { ...s.search, result: null, error: null },
  }));
  session.setFocused(0);
}

export function focusGroup(n: 1 | 2) {
  const s = get();
  if (n === 1) {
    if (s.split) focusPane(0);
    else session.focus();
    return;
  }
  if (s.split) focusPane(1);
  else toggleSplit();
}

export function focusGroupStep(step: -1 | 1) {
  const s = get();
  if (!s.split) return;
  focusPane(step > 0 ? 1 : 0);
}

export function moveEditorToGroup(step: -1 | 1) {
  const s = get();
  if (!s.active) return;
  if (!s.split) {
    if (step > 0) toggleSplit();
    return;
  }
  const target: 0 | 1 = step > 0 ? 1 : 0;
  const path = s.active;
  focusPane(target, false);
  activate(path);
  session.focus();
}

export function togglePanel() {
  const { terminalOpen, panelTab, terminals } = get();
  if (terminalOpen) {
    set({ terminalOpen: false });
    session.focus();
    return;
  }
  set({ terminalOpen: true });
  if (panelTab === "terminal" && !terminals.length) import("./terminal/manager").then((m) => m.createTerminal());
}

export function showExplorer() {
  set({ sidebarVisible: true, sidebarMode: "files" });
  requestAnimationFrame(() => document.querySelector<HTMLElement>(".tree")?.focus());
}

export async function applyWorkspaceEdit(edit: WorkspaceEdit): Promise<boolean> {
  const byPath = new Map<string, Parameters<typeof session.applyEdits>[1]>();
  for (const [uri, edits] of Object.entries(edit.changes ?? {})) byPath.set(uriToPath(uri), edits);
  for (const change of edit.documentChanges ?? []) {
    if ("edits" in change) byPath.set(uriToPath(change.textDocument.uri), [...(byPath.get(uriToPath(change.textDocument.uri)) ?? []), ...change.edits]);
  }
  for (const [path, edits] of byPath) {
    if (!session.has(path) && !(await openFile(path, { quiet: true, activate: false }))) return false;
    session.applyEdits(path, edits);
  }
  return true;
}

function cursorRange() {
  const view = session.view;
  const path = get().active;
  if (!view || !path || isDiffPath(path)) return null;
  const sel = view.state.selection.main;
  const pos = (offset: number) => {
    const line = view.state.doc.lineAt(offset);
    return { line: line.number - 1, character: offset - line.from };
  };
  return { view, path, range: { start: pos(sel.from), end: pos(sel.to) } };
}

export async function quickFix() {
  const at = cursorRange();
  if (!at) return;
  const actions = await lsp.codeActions(at.path, at.range);
  if (actions === null) return toast("No code actions for this file");
  if (!actions.length) return toast("No code actions available");
  const sorted = [...actions].sort((a, b) => Number(!!b.isPreferred) - Number(!!a.isPreferred));
  const coords = at.view.coordsAtPos(at.view.state.selection.main.head);
  const run = (a: CodeAction) => () => {
    lsp.runCodeAction(at.path, a).then(() => session.focus());
  };
  set({
    menu: {
      x: coords?.left ?? 200,
      y: (coords?.bottom ?? 200) + 4,
      items: sorted.slice(0, 30).map((a) => ({ label: a.title, run: run(a) })),
    },
  });
}

export async function organizeImports() {
  const at = cursorRange();
  if (!at) return;
  const actions = await lsp.codeActions(at.path, at.range, ["source.organizeImports"]);
  const action = actions?.find((a) => !a.kind || a.kind.startsWith("source.organizeImports"));
  if (!action) return toast("Organize Imports isn't available for this file");
  await lsp.runCodeAction(at.path, action);
}

export async function closeOthers(path: string) {
  const others = get().tabs.filter((t) => t.path !== path);
  if (!(await confirmDiscard(others, "Close other tabs?"))) return;
  rememberClosed(others);
  for (const t of others) session.close(t.path);
  set((s) => ({ tabs: s.tabs.filter((t) => t.path === path), split: null }));
  session.setFocused(0);
  activate(path);
}

export async function closeAll() {
  const { tabs } = get();
  if (!(await confirmDiscard(tabs, "Close all tabs?"))) return;
  rememberClosed(tabs);
  for (const t of tabs) session.close(t.path);
  set({ tabs: [], split: null });
  session.setFocused(0);
  activate(null);
}

function setDirty(path: string, dirty: boolean) {
  set((s) => ({ tabs: s.tabs.map((t) => (t.path === path ? { ...t, dirty } : t)) }));
}

const formatting = new Set<string>();

export async function formatDocument(path?: string, explicit = true) {
  const target = path ?? get().active;
  const root = get().root;
  if (!target || !session.has(target) || formatting.has(target)) return false;
  const before = session.content(target);
  if (before === null) return false;
  formatting.add(target);
  try {
    const base = root && target.startsWith(root + "/") ? root : dirname(target);
    const result = await fs.format(target, base, before, eslintFixOnSave());
    if (result.warning) toast(result.warning);
    if (result.tools.length) {
      if (session.content(target) !== before) return false;
      const changed = session.applyFormatted(target, result.content);
      if (explicit && !changed) toast(`Already formatted (${result.tools.join(" + ")})`);
      return true;
    }
    const indent = session.indentOf(target);
    const edits = await lsp.formatting(target, indent.size, indent.unit !== "\t");
    if (edits && session.content(target) === before) {
      session.applyEdits(target, edits);
      return true;
    }
    if (explicit && !result.warning) toast("No formatter found for this file");
    return false;
  } catch (e) {
    if (explicit) toast(`Couldn't format: ${errorText(e)}`);
    return false;
  } finally {
    formatting.delete(target);
  }
}

export async function saveFile(path?: string, opts: { format?: boolean } = {}) {
  const target = path ?? get().active;
  if (!target || !session.has(target)) return;
  if (opts.format !== false && formatOnSave() && !target.endsWith("/.outline/settings.json")) await formatDocument(target, false);
  const content = session.content(target);
  if (content === null) return;
  try {
    await fs.writeFile(target, content);
    session.markSaved(target);
    setDirty(target, false);
    refreshGit(300);
    if (target === (await settingsPath())) applySettings(true);
  } catch (e) {
    toast(`Couldn't save: ${errorText(e)}`);
  }
}

// Writes the active editor to a new path and moves the tab there, leaving the
// original file on disk untouched.
export async function saveAs() {
  const from = get().active;
  if (!from || isDiffPath(from) || !session.has(from)) return;
  const to = await saveDialog({ title: "Save As", defaultPath: from });
  if (typeof to !== "string") return;
  if (to === from) return saveFile(from);
  const content = session.content(from);
  if (content === null) return;
  try {
    await fs.writeFile(to, content);
  } catch (e) {
    toast(`Couldn't save: ${errorText(e)}`);
    return;
  }
  if (get().tabs.some((t) => t.path === to)) {
    session.close(to);
    set((s) => ({ tabs: s.tabs.filter((t) => t.path !== to) }));
  }
  const move = (p: string | null) => (p === from ? to : p);
  set((s) => ({
    tabs: s.tabs.map((t) => (t.path === from ? { ...t, path: to, name: basename(to) } : t)),
    active: move(s.active),
    selected: to,
    split: s.split ? { ...s.split, left: move(s.split.left), right: move(s.split.right) } : null,
  }));
  session.rename(from, to);
  session.markSaved(to);
  if (get().tree[dirname(to)]) await loadDir(dirname(to));
  refreshGit(300);
}

// Discards unsaved edits by reloading the active file from disk.
export async function revertFile() {
  const path = get().active;
  if (!path || isDiffPath(path) || !session.has(path)) return;
  try {
    session.replace(path, await fs.readFile(path));
  } catch (e) {
    toast(`Couldn't revert: ${errorText(e)}`);
  }
}

export function clearRecents() {
  set({ recents: [] });
}

export function restartLanguageServers() {
  lsp.stopAll();
  session.reattachLanguageServers();
  toast("Restarting language servers…");
}

export async function saveAll() {
  const dirty = get().tabs.filter((t) => t.dirty);
  for (const t of dirty) await saveFile(t.path);
  if (dirty.length) toast(`Saved ${dirty.length} file${dirty.length > 1 ? "s" : ""}`);
}

export function cycleTab(step: number) {
  const { tabs, active } = get();
  if (tabs.length < 2) return;
  const i = tabs.findIndex((t) => t.path === active);
  activate(tabs[(i + step + tabs.length) % tabs.length].path);
}

export function selectTab(n: number) {
  const { tabs } = get();
  const tab = n === 0 ? tabs[tabs.length - 1] : tabs[n - 1];
  if (tab) activate(tab.path);
}

export function moveTab(from: string, to: string) {
  set((s) => {
    const tabs = [...s.tabs];
    const a = tabs.findIndex((t) => t.path === from);
    const b = tabs.findIndex((t) => t.path === to);
    if (a < 0 || b < 0) return {};
    const [tab] = tabs.splice(a, 1);
    tabs.splice(b, 0, tab);
    return { tabs };
  });
}

function targetDir(path?: string | null) {
  const { root, tree } = get();
  if (!path) return root;
  const isDir = path === root || Object.values(tree).some((list) => list.some((e) => e.path === path && e.is_dir));
  return isDir ? path : dirname(path);
}

function dirHint(dir: string) {
  const { root } = get();
  return root && dir === root ? basename(root) : relative(root, dir);
}

export function newFile(base?: string | null) {
  const dir = targetDir(base ?? get().selected);
  if (!dir) return;
  set({
    dialog: {
      kind: "input",
      title: "New File",
      hint: dirHint(dir),
      value: "",
      placeholder: "name.ext — paths like src/utils/x.ts work too",
      submitLabel: "Create",
      onSubmit: async (name) => {
        const path = join(dir, name.trim());
        await fs.createFile(path);
        set((s) => ({ expanded: { ...s.expanded, [dir]: true } }));
        await loadDir(dir);
        await openFile(path);
      },
    },
  });
}

export function newFolder(base?: string | null) {
  const dir = targetDir(base ?? get().selected);
  if (!dir) return;
  set({
    dialog: {
      kind: "input",
      title: "New Folder",
      hint: dirHint(dir),
      value: "",
      placeholder: "folder-name",
      submitLabel: "Create",
      onSubmit: async (name) => {
        const path = join(dir, name.trim());
        await fs.createDir(path);
        set((s) => ({ expanded: { ...s.expanded, [dir]: true, [path]: true } }));
        await loadDir(dir);
        await loadDir(path);
      },
    },
  });
}

function followMove(path: string, next: string) {
  const move = (p: string) => (p === path ? next : p.startsWith(path + "/") ? next + p.slice(path.length) : p);
  const moveKeys = <T,>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).map(([k, v]) => [move(k), v]));
  const before = get().tabs.map((t) => t.path);
  set((s) => ({
    tabs: s.tabs.map((t) => (t.path === move(t.path) ? t : { ...t, path: move(t.path), name: t.path === path ? basename(next) : t.name })),
    active: s.active && move(s.active),
    split: s.split ? { ...s.split, left: s.split.left && move(s.split.left), right: s.split.right && move(s.split.right) } : null,
    history: { ...s.history, stack: s.history.stack.map(move) },
    mdPreview: moveKeys(s.mdPreview),
    expanded: moveKeys(s.expanded),
  }));
  for (const old of before) {
    const now = move(old);
    if (now !== old) session.rename(old, now);
  }
  fileCache = null;
}

export async function moveEntries(input: string[], dir: string) {
  const unique = [...new Set(input)];
  const paths = unique.filter(
    (p) => !unique.some((o) => o !== p && p.startsWith(o + "/")) && dirname(p) !== dir && dir !== p && !dir.startsWith(p + "/"),
  );
  if (!paths.length) return;
  const parents = new Set<string>([dir]);
  const moved: string[] = [];
  for (const path of paths) {
    const next = join(dir, basename(path));
    try {
      await fs.rename(path, next);
      followMove(path, next);
      parents.add(dirname(path));
      moved.push(next);
    } catch (e) {
      toast(`${basename(path)}: ${errorText(e)}`);
    }
  }
  set((s) => ({ expanded: dir === s.root ? s.expanded : { ...s.expanded, [dir]: true }, selection: moved, selected: moved[moved.length - 1] ?? s.selected, selectionAnchor: null }));
  await Promise.all([...parents].map(loadDir));
  await Promise.all(Object.keys(get().expanded).filter((p) => moved.some((m) => p === m || p.startsWith(m + "/"))).map(loadDir));
  refreshGit();
}

export function renameEntry(path: string) {
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  set({
    dialog: {
      kind: "input",
      title: "Rename",
      value: name,
      placeholder: "New name",
      selectUntil: dot > 0 ? dot : name.length,
      submitLabel: "Rename",
      onSubmit: async (value) => {
        if (value.includes("/")) throw new Error("Names can't contain “/”.");
        const next = join(dirname(path), value.trim());
        if (next === path) return;
        await fs.rename(path, next);
        followMove(path, next);
        set({ selected: next, selection: [next], selectionAnchor: null });
        await loadDir(dirname(path));
        await Promise.all(Object.keys(get().expanded).filter((p) => p === next || p.startsWith(next + "/")).map(loadDir));
      },
    },
  });
}

export function visibleTreeOrder(): string[] {
  const { root, tree, expanded } = get();
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of tree[dir] ?? []) {
      out.push(e.path);
      if (e.is_dir && expanded[e.path]) walk(e.path);
    }
  };
  if (root) walk(root);
  return out;
}

export function selectInTree(path: string, mode: "single" | "range" | "toggle") {
  const s = get();
  if (mode === "single") {
    set({ selected: path, selection: [path] });
    return;
  }
  if (mode === "toggle") {
    const base = s.selection.length ? s.selection : s.selected ? [s.selected] : [];
    const selection = base.includes(path) ? base.filter((p) => p !== path) : [...base, path];
    set({ selected: path, selection });
    return;
  }
  const order = visibleTreeOrder();
  const anchor = s.selectionAnchor ?? s.selected;
  const a = anchor ? order.indexOf(anchor) : -1;
  const b = order.indexOf(path);
  if (a < 0 || b < 0) {
    set({ selected: path, selection: [path] });
    return;
  }
  const [from, to] = a < b ? [a, b] : [b, a];
  set({ selection: order.slice(from, to + 1), selectionAnchor: anchor });
}

export function treeSelection(): string[] {
  const { selection, selected } = get();
  if (selection.length) return selection;
  return selected ? [selected] : [];
}

export function deleteSelected() {
  const paths = treeSelection();
  if (paths.length) deleteEntries(paths);
}

export function deleteEntry(path: string) {
  const selection = treeSelection();
  deleteEntries(selection.length > 1 && selection.includes(path) ? selection : [path]);
}

export function deleteEntries(input: string[]) {
  const { root } = get();
  const unique = [...new Set(input)].filter((p) => p !== root);
  const paths = unique.filter((p) => !unique.some((o) => o !== p && p.startsWith(o + "/")));
  if (!paths.length) return;
  const title = paths.length === 1 ? `Move ${basename(paths[0])} to Trash?` : `Move ${paths.length} items to Trash?`;
  const preview = paths.length > 1 ? paths.slice(0, 6).map(basename).join(", ") + (paths.length > 6 ? `, and ${paths.length - 6} more` : "") : null;
  set({
    dialog: {
      kind: "confirm",
      title,
      message: preview ? `${preview}. You can restore them from the macOS Trash.` : "You can restore it from the macOS Trash.",
      buttons: [
        { label: "Cancel", kind: "plain", run: () => {} },
        {
          label: "Move to Trash",
          kind: "danger",
          run: async () => {
            const dirs = new Set<string>();
            for (const path of paths) {
              try {
                await fs.remove(path);
                dirs.add(dirname(path));
                const affected = get().tabs.filter((t) => t.path === path || t.path.startsWith(path + "/"));
                for (const t of affected) {
                  setDirty(t.path, false);
                  await closeTab(t.path);
                }
              } catch (e) {
                toast(errorText(e));
              }
            }
            set({ selection: [], selectionAnchor: null, selected: null });
            await Promise.all([...dirs].map(loadDir));
            requestAnimationFrame(() => document.querySelector<HTMLElement>(".tree")?.focus());
          },
        },
      ],
    },
  });
}

export async function projectFiles(): Promise<string[]> {
  const { root } = get();
  if (!root) return [];
  if (fileCache?.root === root) return fileCache.files;
  const files = await fs.listFiles(root);
  fileCache = { root, files };
  return files;
}

export function toggleSidebar() {
  set((s) => ({ sidebarVisible: !s.sidebarVisible }));
  requestAnimationFrame(() => session.remeasure());
}

export function setFontSize(size: number | "reset") {
  const next = size === "reset" ? 15 : Math.max(10, Math.min(28, size));
  set({ fontSize: next });
  requestAnimationFrame(() => session.remeasure());
}

export function setEditorFont(font: string) {
  set({ editorFont: font });
  requestAnimationFrame(() => session.remeasure());
}

export function setColorTheme(id: string) {
  set({ colorTheme: id });
}

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

export function applyAppearance() {
  const mode = appearance();
  const dark = mode === "dark" || (mode === "system" && darkQuery.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  if (get().dark !== dark) set({ dark });
  getCurrentWindow()
    .setTheme(mode === "system" ? null : mode)
    .catch(() => {});
  applyColorTheme(get().colorTheme);
}

export async function applySettings(notify = false) {
  const { settings: s, error } = await loadSettings();
  if (error) {
    toast(`settings.json: ${error}`);
    return;
  }
  const patch: Partial<ReturnType<typeof get>> = {};
  if (typeof s["editor.fontFamily"] === "string") patch.editorFont = s["editor.fontFamily"];
  if (typeof s["editor.fontSize"] === "number") patch.fontSize = Math.max(10, Math.min(28, s["editor.fontSize"]));
  if (typeof s["workbench.colorTheme"] === "string") patch.colorTheme = s["workbench.colorTheme"];
  if (typeof s["window.glass"] === "number") patch.glass = Math.max(0.4, Math.min(1, s["window.glass"]));
  if (typeof s["editor.wordWrap"] === "boolean" && s["editor.wordWrap"] !== get().wrap) {
    patch.wrap = s["editor.wordWrap"];
    session.setWrap(s["editor.wordWrap"]);
  }
  set(patch);
  setFolderCustomizations(s["material-icon-theme.folders.associations"], s["material-icon-theme.folders.customClones"]).then(() =>
    set((st) => ({ iconsVersion: st.iconsVersion + 1 })),
  );
  if (typeof s["editor.fontWeight"] === "number") document.documentElement.style.setProperty("--editor-font-weight", String(s["editor.fontWeight"]));
  else document.documentElement.style.removeProperty("--editor-font-weight");
  import("./terminal/manager").then((m) => m.applyTerminalSettings());
  import("./menu").then((m) => m.refreshMenu());
  applyAppearance();
  requestAnimationFrame(() => session.remeasure());
  if (notify) toast("Settings applied");
}

export async function openSettings(section?: string) {
  await applySettings();
  const path = await settingsPath();
  if (!(await openFile(path))) return;
  if (!section) return;
  requestAnimationFrame(() => {
    const view = session.view;
    if (!view) return;
    const at = view.state.doc.toString().indexOf(`"${section}"`);
    if (at >= 0) session.reveal(view.state.doc.lineAt(at).number, 0, 0);
  });
}

export async function openLog() {
  try {
    const path = await fs.logPath();
    if (await openFile(path)) {
      requestAnimationFrame(() => {
        const v = session.view;
        if (v) v.dispatch({ selection: { anchor: v.state.doc.length }, scrollIntoView: true });
      });
    }
  } catch (e) {
    toast(errorText(e));
  }
}

export function toggleProblems() {
  const s = get();
  if (s.terminalOpen && s.panelTab === "problems") {
    set({ terminalOpen: false });
    session.focus();
  } else set({ terminalOpen: true, panelTab: "problems" });
}

export function toggleMarkdownPreview(path?: string) {
  const target = path ?? get().active;
  if (!target || !/\.(md|markdown|mdx)$/i.test(target)) {
    toast("Markdown preview works with .md files");
    return;
  }
  set((s) => {
    const mdPreview = { ...s.mdPreview };
    if (mdPreview[target]) delete mdPreview[target];
    else mdPreview[target] = true;
    return { mdPreview };
  });
  requestAnimationFrame(() => session.remeasure());
}

export async function openDiff(path: string, side: DiffSide = "work") {
  await openFile(diffPath(path, side));
}

async function gitRun(label: string, fn: (root: string) => Promise<void>, done?: string) {
  const { root, git } = get();
  if (!root || git.busy) return false;
  set((s) => ({ git: { ...s.git, busy: label } }));
  try {
    await fn(root);
    if (done) toast(done);
    return true;
  } catch (e) {
    toast(errorText(e));
    return false;
  } finally {
    set((s) => ({ git: { ...s.git, busy: null } }));
    refreshGit();
  }
}

export const gitActions = {
  stage: (paths: string[]) => gitRun("Staging", (root) => gitApi.stage(root, paths)),
  unstage: (paths: string[]) => gitRun("Unstaging", (root) => gitApi.unstage(root, paths)),
  discard(paths: string[]) {
    const entries = get().git.entries.filter((e) => paths.includes(e.path));
    const untracked = entries.filter((e) => e.x === "?").map((e) => e.path);
    const tracked = entries.filter((e) => e.x !== "?").map((e) => e.path);
    const label = paths.length === 1 ? basename(paths[0]) : `${paths.length} files`;
    set({
      dialog: {
        kind: "confirm",
        title: `Discard changes in ${label}?`,
        message: untracked.length
          ? "Tracked changes will be lost. Untracked files will be moved to the Trash."
          : "Your changes will be lost. This can't be undone.",
        buttons: [
          { label: "Cancel", kind: "plain", run: () => {} },
          {
            label: "Discard",
            kind: "danger",
            run: async () => {
              const ok = await gitRun("Discarding", (root) => gitApi.discard(root, tracked, untracked));
              if (!ok) return;
              for (const p of paths) {
                if (!session.has(p) || session.isDirty(p)) continue;
                const content = await fs.readFile(p).catch(() => null);
                if (content !== null) session.replace(p, content);
              }
            },
          },
        ],
      },
    });
  },
  async commit(all: boolean) {
    const { message } = get().git;
    if (!message.trim()) {
      toast("Write a commit message first");
      return;
    }
    const dirty = get().tabs.filter((t) => t.dirty);
    if (dirty.length) await saveAll();
    const ok = await gitRun("Committing", (root) => gitApi.commit(root, message.trim(), all), "Committed");
    if (ok) set((s) => ({ git: { ...s.git, message: "" } }));
  },
  push: () => gitRun("Pushing", (root) => gitApi.push(root), "Pushed"),
  pull: () => gitRun("Pulling", (root) => gitApi.pull(root), "Pulled"),
  sync: () =>
    gitRun(
      "Syncing",
      async (root) => {
        await gitApi.pull(root);
        await gitApi.push(root);
      },
      "Synced",
    ),
  fetch: () => gitRun("Fetching", (root) => gitApi.fetch(root)),
};

export function showGit() {
  set({ sidebarVisible: true, sidebarMode: "git" });
  refreshGit();
}

export function setGlass(value: number) {
  set({ glass: Math.round(Math.max(0.4, Math.min(1, value)) * 100) / 100 });
}

export function toggleWrap() {
  const wrap = !get().wrap;
  set({ wrap });
  session.setWrap(wrap);
}

export function revealActive() {
  const { active } = get();
  if (active) fs.reveal(active).catch(() => {});
}

export async function copyPath(path: string, rel = false) {
  const text = rel ? relative(get().root, path) : path;
  await navigator.clipboard.writeText(text);
  toast("Path copied");
}

let searchSeq = 0;
let searchTimer: number | undefined;

export function setSearchQuery(query: string) {
  set((s) => ({ search: { ...s.search, query } }));
  scheduleSearch();
}

export function toggleSearchOption(key: keyof SearchOptions) {
  set((s) => ({ search: { ...s.search, options: { ...s.search.options, [key]: !s.search.options[key] } } }));
  scheduleSearch(0);
}

function scheduleSearch(delay = 220) {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(runSearch, delay);
}

export async function runSearch() {
  const { root, search } = get();
  const seq = ++searchSeq;
  if (!root || !search.query) {
    set((s) => ({ search: { ...s.search, result: null, loading: false, error: null } }));
    return;
  }
  set((s) => ({ search: { ...s.search, loading: true } }));
  try {
    const result = await fs.search(root, search.query, search.options);
    if (seq !== searchSeq) return;
    set((s) => ({ search: { ...s.search, result, loading: false, error: null, collapsed: {} } }));
  } catch (e) {
    if (seq !== searchSeq) return;
    set((s) => ({ search: { ...s.search, result: null, loading: false, error: errorText(e) } }));
  }
}

export function showSearch(replace = false) {
  const view = session.view;
  let seed = "";
  if (view && get().active) {
    const sel = view.state.selection.main;
    if (!sel.empty && sel.to - sel.from < 200) seed = view.state.sliceDoc(sel.from, sel.to).split("\n")[0];
  }
  set((s) => {
    const query = seed || s.search.query;
    return {
      sidebarVisible: true,
      sidebarMode: "search",
      search: {
        ...s.search,
        query,
        replaceOpen: replace || s.search.replaceOpen,
        // Jump straight to the replace field when there is already something to replace.
        focusField: replace && query ? "replace" : "query",
        focusToken: s.search.focusToken + 1,
      },
    };
  });
  if (seed) scheduleSearch(0);
}

export function setReplaceText(replace: string) {
  set((s) => ({ search: { ...s.search, replace } }));
}

export function toggleReplace() {
  set((s) => ({ search: { ...s.search, replaceOpen: !s.search.replaceOpen } }));
}

// Open files are edited in their editor so the change can be undone; a file with
// unsaved changes stays unsaved. Everything else is rewritten on disk.
async function replaceIn(paths: string[], target?: ReplaceTarget): Promise<number> {
  const { query, options, replace } = get().search;
  let total = 0;
  const onDisk: string[] = [];
  for (const path of paths) {
    if (!session.has(path)) {
      onDisk.push(path);
      continue;
    }
    const before = session.content(path);
    if (before === null) continue;
    const wasDirty = session.isDirty(path);
    const result = await fs.replaceInText(before, query, options, replace, target);
    if (!result.count || session.content(path) !== before) continue;
    session.applyFormatted(path, result.text, "input.replace");
    if (!wasDirty) await saveFile(path, { format: false });
    total += result.count;
  }
  if (onDisk.length) total += await fs.replaceInFiles(onDisk, query, options, replace, target);
  return total;
}

async function runReplace(paths: string[], target?: ReplaceTarget) {
  try {
    const n = await replaceIn(paths, target);
    toast(n ? `Replaced ${n.toLocaleString()} occurrence${n === 1 ? "" : "s"}` : "Nothing replaced: the file changed since the search ran");
  } catch (e) {
    toast(`Couldn't replace: ${errorText(e)}`);
  } finally {
    runSearch();
    refreshGit(300);
  }
}

export function replaceAll() {
  const { result, query, replace } = get().search;
  if (!query || !result?.files.length) return;
  if (result.truncated) {
    toast("Too many results to replace at once. Narrow the search first.");
    return;
  }
  const n = result.total;
  const fileCount = result.files.length;
  set({
    dialog: {
      kind: "confirm",
      title: `Replace ${n.toLocaleString()} occurrence${n === 1 ? "" : "s"} in ${fileCount} file${fileCount === 1 ? "" : "s"}?`,
      message: replace ? `“${query}” will be replaced with “${replace}”.` : `Every match of “${query}” will be deleted.`,
      buttons: [
        { label: "Cancel", kind: "plain", run: () => {} },
        { label: "Replace All", kind: "primary", run: () => runReplace(result.files.map((f) => f.path)) },
      ],
    },
  });
}

export function replaceInFile(path: string) {
  return runReplace([path]);
}

export function replaceMatch(path: string, line: number, col: number) {
  return runReplace([path], { line, col });
}

export function toggleSearchCollapsed(path: string) {
  set((s) => {
    const collapsed = { ...s.search.collapsed };
    if (collapsed[path]) delete collapsed[path];
    else collapsed[path] = true;
    return { search: { ...s.search, collapsed } };
  });
}

export async function openMatch(path: string, line: number, col: number, len: number) {
  if (await openFile(path)) requestAnimationFrame(() => session.reveal(line, col, len));
}

async function onFsChange(paths: string[]) {
  fileCache = null;
  const { tree, tabs } = get();
  const dirs = new Set<string>();
  for (const p of paths) {
    const parent = dirname(p);
    if (tree[parent]) dirs.add(parent);
    if (tree[p]) dirs.add(p);
  }
  await Promise.all([...dirs].map(loadDir));
  const changedMedia = tabs.filter((t) => paths.includes(t.path) && isImage(t.path));
  if (changedMedia.length) {
    set((s) => {
      const mediaRev = { ...s.mediaRev };
      for (const t of changedMedia) mediaRev[t.path] = (mediaRev[t.path] ?? 0) + 1;
      return { mediaRev };
    });
  }
  for (const t of tabs) {
    if (!paths.includes(t.path) || !session.has(t.path) || session.isDirty(t.path) || formatting.has(t.path)) continue;
    try {
      const content = await fs.readFile(t.path);
      session.replace(t.path, content);
    } catch {}
  }
  refreshGit(400);
}

let quitting = false;

export async function onQuitRequested() {
  if (quitting) {
    invoke("quit_ack", { cancelled: false }).catch(() => {});
    return;
  }
  quitting = true;
  await invoke("quit_ack", { cancelled: false }).catch(() => {});
  const ok = await confirmDiscard(get().tabs, "Quit Outline?");
  quitting = false;
  if (ok) {
    flushPersist();
    await invoke("quit_app").catch(() => {});
  } else {
    invoke("quit_ack", { cancelled: true }).catch(() => {});
  }
}

export async function boot() {
  startPersistence();
  session.setFocusHandler((pane) => focusPane(pane, false));
  setDisplayHandler(async (path) => ((await openFile(path)) ? session.view : null));
  setApplyEditHandler(applyWorkspaceEdit);
  setServerExitHandler((server) => toast(`The ${server} language server stopped. Run “Restart Language Servers” to start it again.`));
  listen<string[]>("fs-change", (e) => onFsChange(e.payload));
  listen("git-change", () => refreshGit(300));
  listen("quit-requested", () => onQuitRequested());
  window.addEventListener("focus", () => refreshGit(100));
  darkQuery.addEventListener("change", applyAppearance);
  getCurrentWindow().onCloseRequested(async (event) => {
    flushPersist();
    if (!get().tabs.some((t) => t.dirty)) return;
    event.preventDefault();
    if (await confirmDiscard(get().tabs, "Close Outline?")) {
      set((s) => ({ tabs: s.tabs.map((t) => ({ ...t, dirty: false })) }));
      getCurrentWindow().destroy();
    }
  });
  listen<OpenRequest>("open-path", (e) => openPath(e.payload));
  await applySettings().catch((e) => console.error("settings", e));
  import("./menu").then((m) => m.installMenu()).catch((e) => console.error("menu", e));
  try {
    const saved = persistLoad();
    const launch = await fs.launchPath().catch(() => null);
    if (launch) await openPath(launch, saved);
    else if (saved.root) await setRoot(saved.root, { tabs: saved.tabs, active: saved.active });
  } catch (e) {
    console.error("restore failed", e);
  } finally {
    set({ ready: true });
  }
}

async function openPath(req: OpenRequest, saved?: ReturnType<typeof persistLoad>) {
  const restore = saved?.root ? { tabs: saved.tabs, active: saved.active } : undefined;
  if (req.is_dir) {
    if (get().root === req.path) return;
    await setRoot(req.path, saved?.root === req.path ? restore : undefined);
    return;
  }
  const { root } = get();
  if (!root || !req.path.startsWith(root + "/")) {
    const parent = saved?.root && req.path.startsWith(saved.root + "/") ? saved.root : dirname(req.path);
    await setRoot(parent, saved?.root === parent ? restore : undefined);
    if (get().root !== parent) return;
  }
  await openFile(req.path);
}

if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
