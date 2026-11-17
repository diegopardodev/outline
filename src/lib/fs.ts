import { Channel, invoke } from "@tauri-apps/api/core";

export type Entry = { name: string; path: string; is_dir: boolean };
export type SearchMatch = { line: number; col: number; len: number; before: string; text: string; after: string };
export type SearchFile = { path: string; matches: SearchMatch[] };
export type SearchResult = { files: SearchFile[]; total: number; truncated: boolean };
export type GitStatus = {
  branch: string | null;
  top: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  changes: [string, string][];
  entries: { path: string; x: string; y: string }[];
};
export type Formatted = { content: string; tools: string[]; warning: string | null };
export type PtyEvent = { kind: "Data"; data: string } | { kind: "Exit" };

export type OpenRequest = { path: string; is_dir: boolean };

type SearchFlags = { caseSensitive: boolean; wholeWord: boolean; regex: boolean };
/** One match to replace: 1-based line and UTF-16 column, as search reports them. */
export type ReplaceTarget = { line: number; col: number };
const flagArgs = (o: SearchFlags) => ({ caseSensitive: o.caseSensitive, wholeWord: o.wholeWord, isRegex: o.regex });

export const fs = {
  launchPath: () => invoke<OpenRequest | null>("take_launch_path"),
  readDir: (path: string) => invoke<Entry[]>("read_dir", { path }),
  readFile: (path: string) => invoke<string>("read_file", { path }),
  readBytes: (path: string) => invoke<ArrayBuffer>("read_bytes", { path }),
  writeFile: (path: string, content: string) => invoke<void>("write_file", { path, content }),
  createFile: (path: string) => invoke<void>("create_file", { path }),
  createDir: (path: string) => invoke<void>("create_dir", { path }),
  rename: (from: string, to: string) => invoke<void>("rename_path", { from, to }),
  remove: (path: string) => invoke<void>("delete_path", { path }),
  listFiles: (root: string) => invoke<string[]>("list_files", { root }),
  watch: (root: string) => invoke<void>("watch_root", { root }),
  reveal: (path: string) => invoke<void>("reveal_in_finder", { path }),
  search: (root: string, query: string, opts: { caseSensitive: boolean; wholeWord: boolean; regex: boolean }) =>
    invoke<SearchResult>("search_project", {
      root,
      query,
      caseSensitive: opts.caseSensitive,
      wholeWord: opts.wholeWord,
      isRegex: opts.regex,
    }),
  replaceInText: (text: string, query: string, opts: SearchFlags, replacement: string, target?: ReplaceTarget) =>
    invoke<{ text: string; count: number }>("replace_in_text", { text, query, replacement, target: target ?? null, ...flagArgs(opts) }),
  replaceInFiles: (paths: string[], query: string, opts: SearchFlags, replacement: string, target?: ReplaceTarget) =>
    invoke<number>("replace_in_files", { paths, query, replacement, target: target ?? null, ...flagArgs(opts) }),
  git: (root: string) => invoke<GitStatus>("git_status", { root }),
  format: (path: string, root: string, content: string, eslint: boolean) =>
    invoke<Formatted>("format_file", { path, root, content, eslint }),
  logPath: () => invoke<string>("log_path"),
};

export const git = {
  show: (root: string, path: string, rev: "index" | "head") => invoke<string | null>("git_show", { root, path, rev }),
  stage: (root: string, paths: string[]) => invoke<void>("git_stage", { root, paths }),
  unstage: (root: string, paths: string[]) => invoke<void>("git_unstage", { root, paths }),
  discard: (root: string, tracked: string[], untracked: string[]) => invoke<void>("git_discard", { root, tracked, untracked }),
  commit: (root: string, message: string, all: boolean) => invoke<void>("git_commit", { root, message, all }),
  push: (root: string) => invoke<void>("git_push", { root }),
  pull: (root: string) => invoke<void>("git_pull", { root }),
  fetch: (root: string) => invoke<void>("git_fetch", { root }),
};

export const pty = {
  spawn: (id: number, cwd: string | null, cols: number, rows: number, onEvent: (e: PtyEvent) => void) => {
    const channel = new Channel<PtyEvent>();
    channel.onmessage = onEvent;
    return invoke<void>("pty_spawn", { id, cwd, cols, rows, onEvent: channel });
  },
  write: (id: number, data: string) => invoke<void>("pty_write", { id, data }),
  resize: (id: number, cols: number, rows: number) => invoke<void>("pty_resize", { id, cols, rows }),
  kill: (id: number) => invoke<void>("pty_kill", { id }),
};

export const basename = (p: string) => p.slice(p.lastIndexOf("/") + 1);
export const dirname = (p: string) => p.slice(0, Math.max(p.lastIndexOf("/"), 1));
export const join = (a: string, b: string) => (a.endsWith("/") ? a + b : `${a}/${b}`);
export const relative = (root: string | null, p: string) =>
  root && p.startsWith(root + "/") ? p.slice(root.length + 1) : p;
export const tildify = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");

export const errorText = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : String(e));
