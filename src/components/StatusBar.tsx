import type { MouseEvent } from "react";
import { ArrowDown, ArrowUp, CircleAlert, FileDiff, GitBranch, TriangleAlert } from "lucide-react";
import { get, set, useStore, type MenuItem } from "../store";
import { showGit, toggleProblems } from "../actions";
import { session } from "../editor/session";
import { languageName } from "../lib/languages";
import { isDiffPath } from "../lib/diffpath";
import { bindingLabel } from "../commands";
import { useProblemCounts } from "./Problems";

const tip = (label: string, id: string) => {
  const key = bindingLabel(id);
  return key ? `${label} (${key})` : label;
};

// Opens a context menu just above the clicked status bar item.
function openMenu(e: MouseEvent<HTMLElement>, items: MenuItem[]) {
  const r = e.currentTarget.getBoundingClientRect();
  set({ menu: { x: r.left, y: r.top - 4, items } });
}

function activeEditorPath() {
  const path = get().active;
  return path && !isDiffPath(path) && session.has(path) ? path : null;
}

function indentMenu(e: MouseEvent<HTMLElement>) {
  const path = activeEditorPath();
  if (!path) return;
  const use = (tabs: boolean, size: number) => () => {
    session.setIndentation(path, tabs, size);
    session.focus();
  };
  openMenu(e, [
    { label: "Indent Using Spaces: 2", run: use(false, 2) },
    { label: "Indent Using Spaces: 4", run: use(false, 4) },
    { label: "Indent Using Tabs", run: use(true, session.indentOf(path).size) },
    "separator",
    { label: "Convert Indentation to Spaces", run: () => session.convertIndentation(path, false) },
    { label: "Convert Indentation to Tabs", run: () => session.convertIndentation(path, true) },
  ]);
}

function eolMenu(e: MouseEvent<HTMLElement>) {
  const path = activeEditorPath();
  if (!path) return;
  const current = get().eol;
  const pick = (eol: "LF" | "CRLF") => () => {
    if (eol !== current) session.setEol(path, eol);
    session.focus();
  };
  openMenu(e, [
    { label: `${current === "LF" ? "✓ " : ""}LF (macOS, Linux)`, run: pick("LF") },
    { label: `${current === "CRLF" ? "✓ " : ""}CRLF (Windows)`, run: pick("CRLF") },
  ]);
}

export function StatusBar() {
  const visible = useStore((s) => s.statusBar);
  const active = useStore((s) => s.active);
  const isEditor = useStore((s) => {
    const tab = s.tabs.find((t) => t.path === s.active);
    return !!tab && !tab.kind;
  });
  const cursor = useStore((s) => s.cursor);
  const indent = useStore((s) => s.indent);
  const eol = useStore((s) => s.eol);
  const branch = useStore((s) => s.git.branch);
  const ahead = useStore((s) => s.git.ahead);
  const behind = useStore((s) => s.git.behind);
  const busy = useStore((s) => s.git.busy);
  const changeCount = useStore((s) => s.git.entries.length);
  const counts = useProblemCounts();

  if (!visible) return null;

  return (
    <footer className="statusbar">
      {branch && (
        <button className="status-item" title={tip("Source Control", "git")} onClick={showGit}>
          <GitBranch size={12} strokeWidth={1.9} />
          {branch}
          {behind > 0 && (
            <>
              <ArrowDown size={11} strokeWidth={2.2} />
              {behind}
            </>
          )}
          {ahead > 0 && (
            <>
              <ArrowUp size={11} strokeWidth={2.2} />
              {ahead}
            </>
          )}
        </button>
      )}
      {branch && changeCount > 0 && (
        <button className="status-item" title={`${changeCount} pending change${changeCount === 1 ? "" : "s"}`} onClick={showGit}>
          <FileDiff size={12} strokeWidth={1.9} />
          {changeCount}
        </button>
      )}
      {busy && <span className="status-item">{busy}…</span>}
      <button className="status-item" title={tip("Problems", "problems")} onClick={toggleProblems}>
        <CircleAlert size={12} strokeWidth={1.9} className={counts.errors ? "sev-error" : undefined} />
        {counts.errors}
        <TriangleAlert size={12} strokeWidth={1.9} className={counts.warnings ? "sev-warning" : undefined} />
        {counts.warnings}
      </button>
      <div className="statusbar-spacer" />
      {isEditor && active && (
        <>
          <button className="status-item" title={tip("Go to Line", "goto-line")} onClick={() => set({ palette: "line" })}>
            Ln {cursor.line}, Col {cursor.col}
            {cursor.selected > 0 && ` (${cursor.selected.toLocaleString()} selected)`}
          </button>
          <button className="status-item" title="Select Indentation" onClick={indentMenu}>
            {indent}
          </button>
          <button className="status-item" title="Select End of Line Sequence" onClick={eolMenu}>
            {eol}
          </button>
          <span className="status-item" title="Encoding">
            UTF-8
          </span>
          <span className="status-item" title="Language">
            {languageName(active)}
          </span>
        </>
      )}
    </footer>
  );
}
