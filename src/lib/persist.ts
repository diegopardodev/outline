const KEY = "outline.session.v1";

export type Persisted = {
  root: string | null;
  tabs: string[];
  active: string | null;
  sidebarWidth: number;
  sidebarVisible: boolean;
  fontSize: number;
  editorFont: string;
  colorTheme: string;
  glass: number;
  wrap: boolean;
  recents: string[];
  expanded: string[];
  terminalHeight: number;
  statusBar: boolean;
  prefsVersion: number;
};

export const defaults: Persisted = {
  root: null,
  tabs: [],
  active: null,
  sidebarWidth: 272,
  sidebarVisible: true,
  fontSize: 15,
  editorFont: "Berkeley Mono",
  colorTheme: "one",
  glass: 0.74,
  wrap: false,
  recents: [],
  expanded: [],
  terminalHeight: 260,
  statusBar: true,
  prefsVersion: 3,
};

export function load(): Persisted {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    const data: Persisted = { ...defaults, ...parsed };
    if (data.editorFont === "SF Mono") data.editorFont = defaults.editorFont;
    if ((parsed.prefsVersion ?? 0) < 3) {
      data.fontSize = defaults.fontSize;
      data.colorTheme = defaults.colorTheme;
    }
    data.prefsVersion = 3;
    return data;
  } catch {
    return defaults;
  }
}

export function save(data: Persisted) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {}
}
