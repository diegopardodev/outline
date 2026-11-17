import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import fuzzysort, { type Prepared } from "fuzzysort";
import { Search } from "lucide-react";
import { useStore, set, get, type PaletteMode } from "../store";
import { basename, join, relative } from "../lib/fs";
import { openFile, openMatch, projectFiles, setColorTheme, setEditorFont, setRoot } from "../actions";
import { tildify } from "../lib/fs";
import { FolderIcon } from "./FileIcon";
import { lsp, type SymbolItem } from "../lsp/client";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { applyColorTheme, colorThemes, type ColorTheme } from "../editor/themes";
import { fontCandidates, fontStack, isInstalled } from "../lib/fonts";
import { Check } from "lucide-react";
import { commandShortcut, commands } from "../commands";
import { session } from "../editor/session";
import { FileIcon } from "./FileIcon";
import { detectTasks, runTask, type Task } from "../tasks";

const kindNames: Record<number, [string, string]> = {
  2: ["M", "module"],
  3: ["N", "module"],
  4: ["P", "module"],
  5: ["C", "class"],
  6: ["m", "method"],
  7: ["p", "property"],
  8: ["f", "property"],
  9: ["c", "method"],
  10: ["E", "enum"],
  11: ["I", "interface"],
  12: ["ƒ", "function"],
  13: ["v", "variable"],
  14: ["k", "constant"],
  15: ["s", "variable"],
  22: ["e", "enum"],
  23: ["S", "class"],
  26: ["T", "interface"],
  1001: ["#", "module"],
};

const pal = (th: ColorTheme) => (get().dark && th.dark ? th.dark : th.palette);

function SymbolKind({ kind }: { kind: number }) {
  const [letter, cls] = kindNames[kind] ?? ["•", "variable"];
  return <span className={`sym-kind sym-${cls}`}>{letter}</span>;
}

function markdownHeadings(path: string): SymbolItem[] {
  const text = session.content(path) ?? "";
  const out: SymbolItem[] = [];
  let fence = false;
  text.split("\n").forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const m = !fence && /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) out.push({ name: m[2], kind: 1001, path, line: i, col: 0, depth: m[1].length - 1 });
  });
  return out;
}

type Item = {
  key: string;
  label: ReactNode;
  detail?: ReactNode;
  icon?: ReactNode;
  shortcut?: string;
  line?: number;
  col?: number;
  run: () => void;
};

function marked(text: string, indexes: ReadonlyArray<number>, offset: number) {
  const set = new Set(indexes);
  const out: ReactNode[] = [];
  let buf = "";
  let on = false;
  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i + offset);
    if (hit !== on && buf) {
      out.push(on ? <mark key={i}>{buf}</mark> : buf);
      buf = "";
    }
    on = hit;
    buf += text[i];
  }
  if (buf) out.push(on ? <mark key="end">{buf}</mark> : buf);
  return out;
}

let prepared: { root: string; list: Prepared[] } | null = null;

export function Palette() {
  const mode = useStore((s) => s.palette);
  if (!mode) return null;
  return <PaletteInner mode={mode} key={mode} />;
}

function PaletteInner({ mode }: { mode: PaletteMode }) {
  const root = useStore((s) => s.root);
  const tabs = useStore((s) => s.tabs);
  const active = useStore((s) => s.active);
  const editorFont = useStore((s) => s.editorFont);
  const installed = useMemo(() => (mode === "font" ? fontCandidates.filter(isInstalled) : []), [mode]);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [files, setFiles] = useState<Prepared[] | null>(null);
  const [symbols, setSymbols] = useState<SymbolItem[] | null>(null);
  const [symbolNote, setSymbolNote] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const origin = useRef<{ view: EditorView; selection: EditorSelection; scroll: ReturnType<EditorView["scrollSnapshot"]> } | null>(null);
  const chosen = useRef(false);
  const close = () => {
    set({ palette: null });
    if (get().active) requestAnimationFrame(() => session.focus());
  };

  useEffect(() => {
    if (mode !== "symbols" || !active) return;
    const view = session.view;
    if (view) origin.current = { view, selection: view.state.selection, scroll: view.scrollSnapshot() };
    let cancelled = false;
    lsp.documentSymbols(active).then((result) => {
      if (cancelled) return;
      if (result && result.length) setSymbols(result);
      else if (/\.(md|markdown|mdx)$/i.test(active)) setSymbols(markdownHeadings(active));
      else {
        setSymbols([]);
        setSymbolNote(result ? "No symbols in this file" : "No language server provides symbols for this file");
      }
    });
    return () => {
      cancelled = true;
      const o = origin.current;
      if (o && !chosen.current && o.view.dom.isConnected) {
        o.view.dispatch({ selection: o.selection, effects: o.scroll });
      }
    };
  }, [mode, active]);

  useEffect(() => {
    if (mode !== "workspace-symbols") return;
    let cancelled = false;
    const q = query.trim();
    if (!q) {
      setSymbols([]);
      setSymbolNote(lsp.hasWorkspaceSymbols() ? "Type to search symbols across the project" : "Open a file with a language server (TypeScript, Rust…) to search symbols");
      return;
    }
    const timer = window.setTimeout(() => {
      lsp.workspaceSymbols(q).then((result) => {
        if (cancelled) return;
        setSymbols(result.slice(0, 200));
        setSymbolNote(result.length ? null : "No matching symbols");
      });
    }, 160);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [mode, query]);

  useEffect(() => {
    if (mode !== "tasks") return;
    let cancelled = false;
    detectTasks().then((list) => !cancelled && setTasks(list));
    return () => {
      cancelled = true;
    };
  }, [mode]);

  useEffect(() => {
    if (mode !== "files" || !root) return;
    projectFiles().then((paths) => {
      if (prepared?.root !== root || prepared.list.length !== paths.length) {
        prepared = { root, list: paths.map((p) => fuzzysort.prepare(p)) };
      }
      setFiles(prepared.list);
    });
  }, [mode, root]);

  const items: Item[] = useMemo(() => {
    if (mode === "symbols" || mode === "workspace-symbols") {
      const all = symbols ?? [];
      const ranked =
        mode === "symbols" && query
          ? fuzzysort.go(query, all, { key: "name", limit: 200 }).map((r) => ({ s: r.obj, idx: r.indexes }))
          : all.map((s) => ({ s, idx: [] as ReadonlyArray<number> }));
      return ranked.map(({ s, idx }, i) => ({
        key: `${s.path}:${s.line}:${s.col}:${i}`,
        icon: <SymbolKind kind={s.kind} />,
        label: (
          <span style={{ paddingLeft: mode === "symbols" && !query ? s.depth * 14 : 0 }}>
            {idx.length ? marked(s.name, idx, 0) : s.name}
          </span>
        ),
        detail:
          mode === "workspace-symbols"
            ? `${s.container ? s.container + " · " : ""}${relative(root, s.path)}`
            : s.detail || (query ? s.container : undefined),
        shortcut: mode === "symbols" ? `${s.line + 1}` : undefined,
        line: s.line,
        col: s.col,
        run: () => {
          chosen.current = true;
          if (mode === "symbols") session.reveal(s.line + 1, s.col, 0);
          else openMatch(s.path, s.line + 1, s.col, 0);
        },
      }));
    }
    if (mode === "tasks") {
      const all = tasks ?? [];
      const ranked = query ? fuzzysort.go(query, all, { key: "label", limit: 60 }).map((r) => ({ t: r.obj, idx: r.indexes })) : all.map((t) => ({ t, idx: [] as ReadonlyArray<number> }));
      return ranked.map(({ t, idx }, i) => ({
        key: `${t.source}:${t.label}:${i}`,
        label: idx.length ? marked(t.label, idx, 0) : t.label,
        detail: t.detail,
        shortcut: t.source,
        run: () => runTask(t),
      }));
    }
    if (mode === "recent") {
      const recents = get().recents;
      const list = query ? fuzzysort.go(query, recents, { limit: 30 }).map((r) => r.target) : recents;
      return list.map((r) => ({
        key: r,
        icon: <FolderIcon name={basename(r)} open={false} size={14} />,
        label: basename(r),
        detail: tildify(r),
        run: () => setRoot(r),
      }));
    }
    if (mode === "theme") {
      const list = query ? fuzzysort.go(query, colorThemes, { key: "name", limit: 20 }).map((r) => r.obj) : colorThemes;
      return list.map((th) => ({
        key: th.id,
        label: th.name,
        icon: <Check size={14} strokeWidth={2} style={{ opacity: th.id === get().colorTheme ? 1 : 0 }} />,
        detail: (
          <span className="theme-swatch">
            {[pal(th).keyword, pal(th).type, pal(th).string, pal(th).function, pal(th).number, pal(th).variable].map((c, i) => (
              <i key={i} style={{ background: c }} />
            ))}
          </span>
        ),
        run: () => setColorTheme(th.id),
      }));
    }
    if (mode === "font") {
      const list = query ? fuzzysort.go(query, installed, { limit: 30 }).map((r) => r.target) : installed;
      const items: Item[] = list.map((f) => ({
        key: f,
        label: <span style={{ fontFamily: fontStack(f) }}>{f}</span>,
        icon: <Check size={14} strokeWidth={2} style={{ opacity: f === editorFont ? 1 : 0 }} />,
        detail: <span style={{ fontFamily: fontStack(f) }}>{"{ } => 0O1lI"}</span>,
        run: () => setEditorFont(f),
      }));
      const custom = query.trim();
      if (custom && !installed.some((f) => f.toLowerCase() === custom.toLowerCase())) {
        items.push({
          key: "custom",
          label: <span style={{ fontFamily: fontStack(custom) }}>Use “{custom}”</span>,
          icon: <Check size={14} strokeWidth={2} style={{ opacity: 0 }} />,
          detail: isInstalled(custom) ? "installed" : "not detected",
          run: () => setEditorFont(custom),
        });
      }
      return items;
    }
    if (mode === "line") {
      const n = parseInt(query, 10);
      const total = session.view?.state.doc.lines ?? 0;
      return [
        {
          key: "line",
          label: Number.isFinite(n) ? `Go to line ${n}` : `Type a line number (1 – ${total})`,
          run: () => Number.isFinite(n) && session.gotoLine(n),
        },
      ];
    }
    if (mode === "commands") {
      const visible = commands.filter((c) => !c.hidden);
      const results = query ? fuzzysort.go(query, visible, { key: "label", limit: 50 }).map((r) => ({ c: r.obj, r })) : visible.map((c) => ({ c, r: null }));
      return results.map(({ c, r }) => ({
        key: c.id,
        label: r ? marked(c.label, r.indexes, 0) : c.label,
        detail: <span className="pal-id">{c.id}</span>,
        shortcut: commandShortcut(c),
        run: c.run,
      }));
    }
    if (!root) return [];
    const toItem = (rel: string, indexes: ReadonlyArray<number> = []): Item => {
      const cut = rel.lastIndexOf("/") + 1;
      const name = rel.slice(cut);
      const dir = rel.slice(0, Math.max(cut - 1, 0));
      const abs = join(root, rel);
      return {
        key: rel,
        icon: <FileIcon path={rel} size={14} />,
        label: marked(name, indexes, cut),
        detail: dir ? marked(dir, indexes, 0) : null,
        run: () => openFile(abs),
      };
    };
    if (!query) {
      const recent = [...tabs].filter((t) => t.path !== active).map((t) => relative(root, t.path));
      const rest = (files ?? []).slice(0, 80).map((p) => p.target).filter((p) => !recent.includes(p));
      return [...recent, ...rest].slice(0, 60).map((r) => toItem(r));
    }
    if (!files) return [];
    return fuzzysort.go(query.replace(/\s+/g, ""), files, { limit: 60, threshold: 0.2 }).map((r) => toItem(r.target, r.indexes));
  }, [mode, query, files, root, tabs, active, installed, editorFont, symbols, tasks]);

  useEffect(() => {
    if (mode !== "theme") return setIndex(0);
    const i = items.findIndex((it) => it.key === get().colorTheme);
    setIndex(query || i < 0 ? 0 : i);
  }, [query]);

  useEffect(() => {
    if (mode === "theme" && items[index]) applyColorTheme(items[index].key);
    const it = items[index];
    if (mode === "symbols" && it?.line != null) session.peek(it.line + 1, it.col ?? 0);
  }, [mode, index, items]);

  useEffect(() => () => applyColorTheme(get().colorTheme), []);
  useEffect(() => {
    list.current?.querySelector(".pal-item.on")?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const choose = (item?: Item) => {
    if (!item) return;
    close();
    item.run();
  };

  const placeholder = {
    files: "Search files by name…",
    commands: "Type a command…",
    line: "Line number…",
    font: "Pick a font or type any installed font name…",
    theme: "Pick a color theme…",
    symbols: "Go to symbol in this file…",
    "workspace-symbols": "Search symbols in the project…",
    recent: "Open a recent folder…",
    tasks: "Select a task to run…",
  }[mode];

  return (
    <div className="overlay" onMouseDown={close}>
      <div className="palette glass" onMouseDown={(e) => e.stopPropagation()}>
        <div className="pal-input">
          <Search size={15} strokeWidth={1.9} />
          <input
            autoFocus
            spellCheck={false}
            value={query}
            placeholder={placeholder}
            inputMode={mode === "line" ? "numeric" : undefined}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                close();
              } else if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
                e.preventDefault();
                setIndex((i) => Math.min(i + 1, items.length - 1));
              } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
                e.preventDefault();
                setIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                choose(items[index]);
              }
            }}
          />
          {mode !== "line" && <span className="pal-mode">{{ files: "Files", commands: "Commands", font: "Font", theme: "Theme", line: "", symbols: active ? basename(active) : "Symbols", "workspace-symbols": "Workspace", recent: "Recent", tasks: "Tasks" }[mode]}</span>}
        </div>
        {items.length > 0 && (
          <div className="pal-list" ref={list}>
            {items.map((it, i) => (
              <div
                key={it.key}
                className={`pal-item${i === index ? " on" : ""}`}
                onMouseMove={() => i !== index && setIndex(i)}
                onClick={() => choose(it)}
              >
                {it.icon}
                <span className="pal-label">{it.label}</span>
                {it.detail && <span className="pal-detail">{it.detail}</span>}
                {it.shortcut && <span className="pal-shortcut">{it.shortcut}</span>}
              </div>
            ))}
          </div>
        )}
        {mode === "files" && query && files && items.length === 0 && <div className="pal-empty">No matching files</div>}
        {mode === "tasks" && items.length === 0 && (
          <div className="pal-empty">
            {tasks === null ? "Looking for tasks…" : query ? "No matching tasks" : "No tasks found in package.json, deno.json, Cargo.toml, go.mod or a Makefile"}
          </div>
        )}
        {(mode === "symbols" || mode === "workspace-symbols") && items.length === 0 && (
          <div className="pal-empty">{symbols === null ? "Loading symbols…" : query && mode === "symbols" ? "No matching symbols" : symbolNote}</div>
        )}
      </div>
    </div>
  );
}
