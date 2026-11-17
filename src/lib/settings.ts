import { invoke } from "@tauri-apps/api/core";

export type Appearance = "system" | "light" | "dark";

export type Settings = {
  "editor.fontFamily"?: string;
  "editor.fontSize"?: number;
  "editor.fontWeight"?: number;
  "editor.tabSize"?: number;
  "editor.insertSpaces"?: boolean;
  "editor.detectIndentation"?: boolean;
  "editor.wordWrap"?: boolean;
  "editor.formatOnSave"?: boolean;
  "editor.eslintFixOnSave"?: boolean;
  "workbench.colorTheme"?: string;
  "workbench.appearance"?: Appearance;
  "window.glass"?: number;
  "terminal.fontSize"?: number;
  "material-icon-theme.folders.associations"?: Record<string, string>;
  "material-icon-theme.folders.customClones"?: { name: string; base: string; color: string; folderNames: string[] }[];
  keybindings?: Record<string, string>;
};

export const settingsTemplate = `// Outline settings. Uncomment a line to override the default.
// Changes apply as soon as you save this file.
{
  // "editor.fontFamily": "Berkeley Mono",
  // "editor.fontSize": 15,
  // "editor.fontWeight": 400,
  // "editor.tabSize": 2,
  // "editor.insertSpaces": true,
  // "editor.detectIndentation": true,
  // "editor.wordWrap": false,
  // "editor.formatOnSave": true,
  // "editor.eslintFixOnSave": false,

  // one, github, xcode, solarized, catppuccin, gruvbox, tokyo-night, rose-pine, dracula, pierre
  // "workbench.colorTheme": "one",
  // "system", "light" or "dark"
  // "workbench.appearance": "system",

  // 0.4 (most transparent) to 1 (opaque)
  // "window.glass": 0.74,
  // "terminal.fontSize": 12.5,

  // Same format as the Material Icon Theme extension in VS Code
  // "material-icon-theme.folders.associations": { "task": "tasks" },
  // "material-icon-theme.folders.customClones": [{ "name": "actions", "base": "folder-shader", "color": "#99a1af", "folderNames": ["actions"] }],

  // Command id to shortcut, e.g. "cmd+shift+e". Ids are shown next to each command in the palette (⇧⌘P).
  "keybindings": {
    // "toggle-sidebar": "cmd+shift+e"
  }
}
`;

export function parseJsonc(text: string): unknown {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 2;
    } else {
      out += c;
      i++;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

export let settings: Settings = {};
let path: string | null = null;

export const formatOnSave = () => settings["editor.formatOnSave"] ?? true;
export const eslintFixOnSave = () => settings["editor.eslintFixOnSave"] ?? false;
export const appearance = (): Appearance => settings["workbench.appearance"] ?? "system";

export async function settingsPath() {
  if (!path) path = await invoke<string>("settings_path");
  return path;
}

export async function loadSettings(): Promise<{ settings: Settings; error: string | null }> {
  try {
    const text = await invoke<string>("read_settings", { template: settingsTemplate });
    const parsed = parseJsonc(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("settings.json must contain an object");
    settings = parsed as Settings;
    return { settings, error: null };
  } catch (e) {
    return { settings, error: e instanceof Error ? e.message : String(e) };
  }
}

export function normalizeShortcut(spec: string) {
  const parts = spec
    .toLowerCase()
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);
  const key = parts.pop() ?? "";
  const mods = new Set(parts.map((m) => ({ command: "cmd", meta: "cmd", option: "alt", opt: "alt", control: "ctrl" })[m] ?? m));
  return ["ctrl", "alt", "shift", "cmd"].filter((m) => mods.has(m)).concat(key).join("+");
}

const codeKeys: Record<string, string> = {
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Space: "space",
  Enter: "enter",
  Tab: "tab",
  Escape: "escape",
  Backspace: "backspace",
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

export function eventShortcut(e: KeyboardEvent) {
  let key = codeKeys[e.code];
  if (!key) {
    if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3).toLowerCase();
    else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
    else if (/^F\d+$/.test(e.code)) key = e.code.toLowerCase();
    else if (/^Numpad\d$/.test(e.code)) key = e.code.toLowerCase();
    else key = e.key.toLowerCase();
  }
  const mods = [e.ctrlKey && "ctrl", e.altKey && "alt", e.shiftKey && "shift", e.metaKey && "cmd"].filter(Boolean);
  return [...mods, key].join("+");
}

export function shortcutLabel(spec: string) {
  const symbols: Record<string, string> = { ctrl: "⌃", alt: "⌥", shift: "⇧", cmd: "⌘" };
  return normalizeShortcut(spec)
    .split("+")
    .map((p) => symbols[p] ?? (p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)))
    .join("");
}
