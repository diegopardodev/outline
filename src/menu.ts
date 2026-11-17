import {
  Menu,
  Submenu,
  type CheckMenuItemOptions,
  type MenuItemOptions,
  type PredefinedMenuItemOptions,
  type SubmenuOptions,
} from "@tauri-apps/api/menu";
import { getVersion } from "@tauri-apps/api/app";
import { commandAccelerator, commandLabel, runMenuCommand } from "./commands";
import { onQuitRequested, setRoot } from "./actions";
import { basename, tildify } from "./lib/fs";
import { get, useStore } from "./store";

type Item = MenuItemOptions | CheckMenuItemOptions | PredefinedMenuItemOptions | SubmenuOptions;

const sep: PredefinedMenuItemOptions = { item: "Separator" };
const native = (item: PredefinedMenuItemOptions["item"], text?: string): PredefinedMenuItemOptions => (text ? { item, text } : { item });

let uid = 0;

// A menu entry that runs a palette command, showing its current keybinding.
function cmd(id: string, text = commandLabel(id)): MenuItemOptions {
  return { id: `${id}#${uid++}`, text, accelerator: commandAccelerator(id), action: () => runMenuCommand(id) };
}

function check(id: string, text: string, checked: boolean): CheckMenuItemOptions {
  return { id: `${id}#${uid++}`, text, checked, accelerator: commandAccelerator(id), action: () => runMenuCommand(id) };
}

const submenu = (text: string, items: Item[]): SubmenuOptions => ({ text, items });

function recentMenu(): SubmenuOptions {
  const recents = get().recents;
  const items: Item[] = recents.map((path) => ({
    id: `recent#${uid++}`,
    text: `${basename(path)}  —  ${tildify(path)}`,
    action: () => setRoot(path),
  }));
  if (items.length) items.push(sep);
  items.push(cmd("recent", "More…"), { ...cmd("clear-recents"), enabled: recents.length > 0 });
  return submenu("Open Recent", items);
}

async function build(version: string): Promise<{ menu: Menu; windowMenu: Submenu; helpMenu: Submenu }> {
  const s = get();
  uid = 0;

  const app = submenu("Outline", [
    native({ About: { name: "Outline", version } }, "About Outline"),
    sep,
    cmd("settings", "Settings…"),
    cmd("keyboard-shortcuts", "Keyboard Shortcuts"),
    cmd("theme", "Color Theme…"),
    sep,
    native("Services"),
    sep,
    native("Hide", "Hide Outline"),
    native("HideOthers"),
    native("ShowAll"),
    sep,
    { id: "quit", text: "Quit Outline", accelerator: "CmdOrCtrl+Q", action: () => onQuitRequested() },
  ]);

  const file = submenu("File", [
    cmd("new-file"),
    cmd("new-folder"),
    sep,
    cmd("open-file"),
    cmd("open-folder"),
    recentMenu(),
    sep,
    cmd("save"),
    cmd("save-as"),
    cmd("save-all"),
    cmd("save-without-formatting"),
    sep,
    cmd("revert-file"),
    cmd("reveal", "Reveal in Finder"),
    sep,
    cmd("close-tab"),
    cmd("close-saved"),
    cmd("close-all"),
    cmd("close-folder"),
  ]);

  // Undo, clipboard and Select All stay native so they also work in text fields
  // and the terminal, not just the editor.
  const edit = submenu("Edit", [
    native("Undo"),
    native("Redo"),
    sep,
    native("Cut"),
    native("Copy"),
    native("Paste"),
    sep,
    cmd("find"),
    cmd("replace"),
    sep,
    cmd("search", "Find in Files"),
    cmd("replace-in-files"),
    sep,
    cmd("toggle-line-comment"),
    cmd("toggle-block-comment"),
    sep,
    cmd("format"),
    cmd("organize-imports"),
    cmd("trim-whitespace"),
  ]);

  const selection = submenu("Selection", [
    native("SelectAll"),
    cmd("expand-selection"),
    cmd("shrink-selection"),
    sep,
    cmd("copy-line-up"),
    cmd("copy-line-down"),
    cmd("move-line-up"),
    cmd("move-line-down"),
    sep,
    cmd("add-cursor-above"),
    cmd("add-cursor-below"),
    cmd("cursors-line-ends"),
    cmd("add-next-occurrence"),
    cmd("select-all-occurrences"),
    sep,
    cmd("select-line"),
  ]);

  const view = submenu("View", [
    cmd("commands", "Command Palette…"),
    sep,
    cmd("explorer", "Explorer"),
    cmd("search", "Search"),
    cmd("git", "Source Control"),
    cmd("problems", "Problems"),
    cmd("terminal", "Terminal"),
    sep,
    submenu("Appearance", [
      check("toggle-sidebar", "Sidebar", s.sidebarVisible),
      check("panel", "Panel", s.terminalOpen),
      check("toggle-status-bar", "Status Bar", s.statusBar),
      sep,
      cmd("zoom-in", "Zoom In"),
      cmd("zoom-out", "Zoom Out"),
      cmd("zoom-reset", "Reset Zoom"),
      sep,
      cmd("glass-more"),
      cmd("glass-less"),
      cmd("glass-reset"),
    ]),
    submenu("Editor Layout", [
      check("split", "Split Editor", !!s.split),
      sep,
      cmd("focus-left-group"),
      cmd("focus-right-group"),
      cmd("move-editor-left"),
      cmd("move-editor-right"),
    ]),
    sep,
    check("toggle-wrap", "Word Wrap", s.wrap),
    cmd("fold-all"),
    cmd("unfold-all"),
    sep,
    cmd("md-preview", "Markdown Preview"),
    cmd("md-preview-side", "Open Markdown Preview to the Side"),
    sep,
    cmd("theme", "Color Theme…"),
    cmd("font", "Editor Font…"),
    sep,
    native("Fullscreen"),
  ]);

  const go = submenu("Go", [
    cmd("back", "Back"),
    cmd("forward", "Forward"),
    sep,
    submenu("Switch Editor", [cmd("next-tab"), cmd("prev-tab"), cmd("reopen-closed")]),
    submenu("Switch Group", [cmd("focus-group-1"), cmd("focus-group-2")]),
    sep,
    cmd("quick-open", "Go to File…"),
    cmd("workspace-symbols", "Go to Symbol in Workspace…"),
    cmd("symbols", "Go to Symbol in Editor…"),
    sep,
    cmd("go-to-definition"),
    cmd("find-references"),
    cmd("rename-symbol"),
    sep,
    cmd("goto-line", "Go to Line…"),
    cmd("go-to-bracket"),
    sep,
    cmd("next-problem", "Next Problem"),
    cmd("prev-problem", "Previous Problem"),
  ]);

  const run = submenu("Run", [
    cmd("run-task"),
    cmd("rerun-task"),
    sep,
    cmd("run-active-file"),
    cmd("run-selection"),
  ]);

  const terminal = submenu("Terminal", [
    cmd("new-terminal"),
    sep,
    cmd("run-task"),
    cmd("run-active-file"),
    cmd("run-selection"),
    sep,
    cmd("clear-terminal", "Clear Terminal"),
    cmd("kill-terminal", "Kill Terminal"),
    sep,
    cmd("terminal"),
  ]);

  const windowMenu = await Submenu.new(
    submenu("Window", [native("Minimize"), native("Maximize", "Zoom"), sep, native("BringAllToFront")]),
  );

  const helpMenu = await Submenu.new(
    submenu("Help", [
      cmd("commands", "Show All Commands"),
      cmd("keyboard-shortcuts"),
      sep,
      cmd("restart-lsp"),
      cmd("log", "Open Log File"),
      cmd("reload"),
    ]),
  );

  const menu = await Menu.new({ items: [app, file, edit, selection, view, go, run, terminal, windowMenu, helpMenu] });
  return { menu, windowMenu, helpMenu };
}

let installed = false;
let version = "";
let timer: number | undefined;
let building: Promise<void> = Promise.resolve();

async function apply() {
  const { menu, windowMenu, helpMenu } = await build(version);
  const previous = await menu.setAsAppMenu();
  await windowMenu.setAsWindowsMenuForNSApp();
  await helpMenu.setAsHelpMenuForNSApp();
  previous?.close().catch(() => {});
}

// Rebuilds the menu bar after anything it reflects changes: keybindings, recent
// folders and the checked state of toggles.
export function refreshMenu() {
  if (!installed) return;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    building = building.then(apply).catch((e) => console.error("menu", e));
  }, 120);
}

export async function installMenu() {
  if (installed) return;
  installed = true;
  version = await getVersion().catch(() => "");
  useStore.subscribe((s, p) => {
    if (s.recents !== p.recents || s.wrap !== p.wrap || s.sidebarVisible !== p.sidebarVisible || s.terminalOpen !== p.terminalOpen || s.statusBar !== p.statusBar || !!s.split !== !!p.split) {
      refreshMenu();
    }
  });
  building = apply().catch((e) => console.error("menu", e));
  await building;
}
