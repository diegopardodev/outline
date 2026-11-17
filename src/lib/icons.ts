import manifest from "material-icon-theme/dist/material-icons.json";

type Map = Record<string, string>;
type Manifest = {
  file: string;
  folder: string;
  folderExpanded: string;
  fileExtensions: Map;
  fileNames: Map;
  languageIds: Map;
  folderNames: Map;
  folderNamesExpanded: Map;
  light?: { fileExtensions?: Map; fileNames?: Map; languageIds?: Map; folderNames?: Map; folderNamesExpanded?: Map };
};

const m = manifest as unknown as Manifest;

const urls = import.meta.glob("../../node_modules/material-icon-theme/icons/*.svg", {
  query: "?url",
  import: "default",
  eager: true,
}) as Record<string, string>;

const byName = new globalThis.Map<string, string>();
for (const [path, url] of Object.entries(urls)) {
  byName.set(path.slice(path.lastIndexOf("/") + 1, -4), url);
}

const languageByExt: Map = {
  json: "json",
  jsonc: "jsonc",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  hpp: "cpp",
  cs: "csharp",
  kt: "kotlin",
  kts: "kotlin",
  dart: "dart",
  lua: "lua",
  r: "r",
  zig: "zig",
  bat: "bat",
  ps1: "powershell",
  dockerfile: "dockerfile",
  clj: "clojure",
  ex: "elixir",
  exs: "elixir",
  ml: "ocaml",
};

const cache = new globalThis.Map<string, string>();

let darkMode = false;

function lookup(table: "fileExtensions" | "fileNames" | "languageIds" | "folderNames" | "folderNamesExpanded", key: string): string | undefined {
  return (darkMode ? undefined : m.light?.[table]?.[key]) ?? m[table][key];
}

function resolve(name: string): string {
  const lower = name.toLowerCase();
  const byFile = lookup("fileNames", lower) ?? lookup("fileNames", name);
  if (byFile) return byFile;
  if (lower.startsWith(".env")) return "tune";
  const parts = lower.split(".");
  for (let i = 1; i < parts.length; i++) {
    const ext = parts.slice(i).join(".");
    const hit = lookup("fileExtensions", ext);
    if (hit) return hit;
  }
  const ext = parts.length > 1 ? parts[parts.length - 1] : "";
  const lang = languageByExt[ext];
  if (lang) {
    const hit = lookup("languageIds", lang);
    if (hit) return hit;
  }
  return m.file;
}

export function fileIconUrl(name: string, dark = false): string {
  const key = dark ? `\u0000${name}` : name;
  let url = cache.get(key);
  if (!url) {
    darkMode = dark;
    const icon = resolve(name);
    darkMode = false;
    url = byName.get(icon) ?? byName.get(icon.replace(/_light$/, "")) ?? byName.get(m.file) ?? "";
    cache.set(key, url);
  }
  return url;
}

export type FolderClone = { name: string; base: string; color: string; lightColor?: string; folderNames: string[] };

let folderAssociations: Map = {};
const cloneUrls = new globalThis.Map<string, { closed: string; open: string }>();
const folderCache = new globalThis.Map<string, string>();

const rawFolders = import.meta.glob("../../node_modules/material-icon-theme/icons/folder-*.svg", {
  query: "?raw",
  import: "default",
}) as Record<string, () => Promise<string>>;

function lighten(hex: string, amount: number) {
  const n = parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  const ch = (shift: number) => {
    const v = (n >> shift) & 255;
    return Math.round(v + (255 - v) * amount)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}

async function recolor(base: string, color: string) {
  const load = rawFolders[`../../node_modules/material-icon-theme/icons/${base}.svg`];
  if (!load) return null;
  const svg = (await load())
    .replace(/(id="folder"[^>]*?fill=")[^"]*"/, `$1${color}"`)
    .replace(/(fill=")[^"]*("[^>]*?id="folder")/, `$1${color}$2`)
    .replace(/(id="motive"[^>]*?fill=")[^"]*"/, `$1${lighten(color, 0.7)}"`)
    .replace(/(fill=")[^"]*("[^>]*?id="motive")/, `$1${lighten(color, 0.7)}$2`);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export async function setFolderCustomizations(associations: unknown, clones: unknown) {
  folderAssociations = {};
  if (associations && typeof associations === "object") {
    for (const [k, v] of Object.entries(associations)) if (typeof v === "string") folderAssociations[k.toLowerCase()] = v;
  }
  cloneUrls.clear();
  folderCache.clear();
  if (!Array.isArray(clones)) return;
  for (const c of clones as FolderClone[]) {
    if (!c || typeof c.base !== "string" || typeof c.color !== "string" || !Array.isArray(c.folderNames)) continue;
    const base = c.base.startsWith("folder-") ? c.base : `folder-${c.base}`;
    const [closed, open] = await Promise.all([recolor(base, c.color), recolor(`${base}-open`, c.color)]);
    if (!closed) continue;
    for (const name of c.folderNames) cloneUrls.set(name.toLowerCase(), { closed, open: open ?? closed });
  }
}

function resolveFolder(name: string, open: boolean, dark: boolean): string {
  const lower = name.toLowerCase();
  const assoc = folderAssociations[lower];
  if (assoc) {
    const icon = `folder-${assoc}${open ? "-open" : ""}`;
    if (byName.has(icon)) return byName.get(icon)!;
  }
  const table = open ? "folderNamesExpanded" : "folderNames";
  darkMode = dark;
  const icon = lookup(table, lower) ?? lookup(table, name) ?? (open ? m.folderExpanded : m.folder);
  darkMode = false;
  return byName.get(icon) ?? byName.get(icon.replace(/_light$/, "")) ?? byName.get(open ? m.folderExpanded : m.folder) ?? "";
}

export function folderIconUrl(name: string, open: boolean, dark = false): string {
  const clone = cloneUrls.get(name.toLowerCase());
  if (clone) return open ? clone.open : clone.closed;
  const key = `${dark ? 1 : 0}${open ? 1 : 0}${name}`;
  let url = folderCache.get(key);
  if (!url) {
    url = resolveFolder(name, open, dark);
    folderCache.set(key, url);
  }
  return url;
}
