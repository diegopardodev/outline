import { create } from "zustand";
import type { Entry, SearchResult } from "./lib/fs";
import { load } from "./lib/persist";

export type Tab = { path: string; name: string; dirty: boolean; kind?: "image" | "diff" };

export type Problem = {
  path: string;
  line: number;
  col: number;
  endLine: number;
  endCol: number;
  severity: 1 | 2 | 3 | 4;
  message: string;
  source?: string;
  code?: string;
};

export type GitEntry = { path: string; x: string; y: string };

export type Split = { left: string | null; right: string | null; focus: 0 | 1 };

export type MediaInfo = { path: string; width: number; height: number; bytes: number };

export type DialogButton = { label: string; kind?: "primary" | "danger" | "plain"; run: () => void | Promise<void> };

export type Dialog =
  | {
      kind: "input";
      title: string;
      hint?: string;
      value: string;
      placeholder: string;
      selectUntil?: number;
      submitLabel: string;
      onSubmit: (value: string) => void | Promise<void>;
    }
  | { kind: "confirm"; title: string; message: string; buttons: DialogButton[] };

export type MenuItem = { label: string; shortcut?: string; danger?: boolean; run: () => void } | "separator";

export type ContextMenu = { x: number; y: number; items: MenuItem[] };

export type Cursor = { line: number; col: number; selected: number; lines: number };

export type SearchOptions = { caseSensitive: boolean; wholeWord: boolean; regex: boolean };

export type Search = {
  query: string;
  replace: string;
  replaceOpen: boolean;
  focusField: "query" | "replace";
  options: SearchOptions;
  result: SearchResult | null;
  loading: boolean;
  error: string | null;
  collapsed: Record<string, true>;
  focusToken: number;
};

export type TerminalSession = { id: number; title: string; exited: boolean };

export type Git = {
  branch: string | null;
  top: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  changes: Record<string, string>;
  dirs: Record<string, true>;
  entries: GitEntry[];
  busy: string | null;
  message: string;
};

export const emptyGit: Git = {
  branch: null,
  top: null,
  upstream: null,
  ahead: 0,
  behind: 0,
  changes: {},
  dirs: {},
  entries: [],
  busy: null,
  message: "",
};

export type PaletteMode = "files" | "commands" | "line" | "font" | "theme" | "symbols" | "workspace-symbols" | "recent" | "tasks";

export type State = {
  root: string | null;
  tree: Record<string, Entry[]>;
  expanded: Record<string, true>;
  selected: string | null;
  tabs: Tab[];
  active: string | null;
  sidebarVisible: boolean;
  sidebarWidth: number;
  sidebarMode: "files" | "search" | "git";
  fontSize: number;
  editorFont: string;
  colorTheme: string;
  glass: number;
  wrap: boolean;
  recents: string[];
  cursor: Cursor;
  media: MediaInfo | null;
  mediaRev: Record<string, number>;
  indent: string;
  eol: "LF" | "CRLF";
  statusBar: boolean;
  palette: PaletteMode | null;
  dialog: Dialog | null;
  menu: ContextMenu | null;
  toast: { text: string; id: number } | null;
  git: Git;
  search: Search;
  terminalOpen: boolean;
  panelTab: "terminal" | "problems";
  problems: Record<string, Problem[]>;
  split: Split | null;
  mdPreview: Record<string, true>;
  dark: boolean;
  ready: boolean;
  iconsVersion: number;
  terminalHeight: number;
  terminals: TerminalSession[];
  activeTerminal: number | null;
  history: { stack: string[]; index: number };
};

const p = load();

export const useStore = create<State>(() => ({
  root: p.root,
  tree: {},
  expanded: Object.fromEntries(p.expanded.map((k) => [k, true as const])),
  selected: null,
  tabs: [],
  active: null,
  sidebarVisible: p.sidebarVisible,
  sidebarWidth: p.sidebarWidth,
  sidebarMode: "files",
  fontSize: p.fontSize,
  editorFont: p.editorFont,
  colorTheme: p.colorTheme,
  glass: p.glass,
  wrap: p.wrap,
  recents: p.recents,
  cursor: { line: 1, col: 1, selected: 0, lines: 1 },
  media: null,
  mediaRev: {},
  indent: "Spaces: 2",
  eol: "LF",
  statusBar: p.statusBar,
  palette: null,
  dialog: null,
  menu: null,
  toast: null,
  git: emptyGit,
  search: {
    query: "",
    replace: "",
    replaceOpen: false,
    focusField: "query",
    options: { caseSensitive: false, wholeWord: false, regex: false },
    result: null,
    loading: false,
    error: null,
    collapsed: {},
    focusToken: 0,
  },
  terminalOpen: false,
  panelTab: "terminal",
  problems: {},
  split: null,
  mdPreview: {},
  dark: false,
  ready: false,
  iconsVersion: 0,
  terminalHeight: p.terminalHeight,
  terminals: [],
  activeTerminal: null,
  history: { stack: [], index: -1 },
}));

export const get = useStore.getState;
export const set = useStore.setState;

if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
