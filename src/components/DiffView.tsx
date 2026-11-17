import { useEffect, useRef, useState } from "react";
import { EditorState, Compartment, type Extension } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { MergeView } from "@codemirror/merge";
import { useStore, get } from "../store";
import { errorText, fs, git, relative } from "../lib/fs";
import { parseDiffPath } from "../lib/diffpath";
import { describe } from "../lib/languages";
import { editorHighlight, editorTheme } from "../editor/theme";
import { session } from "../editor/session";
import { gitActions, openFile } from "../actions";

function sideExtensions(lang: Compartment): Extension[] {
  return [
    lineNumbers(),
    editorTheme,
    editorHighlight,
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    lang.of([]),
    EditorView.theme({ "&": { height: "auto" }, ".cm-scroller": { overflow: "visible" } }),
  ];
}

export function DiffView({ tab }: { tab: string }) {
  const info = parseDiffPath(tab);
  const host = useRef<HTMLDivElement>(null);
  const entries = useStore((s) => s.git.entries);
  const root = useStore((s) => s.root);
  const [error, setError] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    if (!info || !root || !host.current) return;
    let cancelled = false;
    let merge: MergeView | null = null;
    const langA = new Compartment();
    const langB = new Compartment();
    const load = async () => {
      const { path, side } = info;
      let a: string;
      let b: string;
      if (side === "staged") {
        a = (await git.show(root, path, "head")) ?? "";
        b = (await git.show(root, path, "index")) ?? "";
      } else {
        a = (await git.show(root, path, "index")) ?? "";
        b = session.has(path) ? session.content(path) ?? "" : await fs.readFile(path).catch(() => "");
      }
      if (cancelled || !host.current) return;
      setEmpty(a === b);
      host.current.replaceChildren();
      merge = new MergeView({
        a: { doc: a, extensions: sideExtensions(langA) },
        b: { doc: b, extensions: sideExtensions(langB) },
        parent: host.current,
        gutter: true,
        highlightChanges: true,
        collapseUnchanged: { margin: 3, minSize: 6 },
      });
      const desc = describe(path);
      if (desc) {
        const support = await desc.load().catch(() => null);
        if (support && merge && !cancelled) {
          merge.a.dispatch({ effects: langA.reconfigure(support) });
          merge.b.dispatch({ effects: langB.reconfigure(support) });
        }
      }
    };
    load().catch((e) => !cancelled && setError(errorText(e)));
    return () => {
      cancelled = true;
      merge?.destroy();
    };
  }, [tab, entries, root]);

  if (!info) return null;
  const staged = info.side === "staged";
  const entry = entries.find((e) => e.path === info.path);

  return (
    <div className="diff-view">
      <div className="diff-head">
        <span className="diff-side">{staged ? "HEAD" : "Index"}</span>
        <span className="diff-arrow">→</span>
        <span className="diff-side">{staged ? "Index" : "Working Tree"}</span>
        <span className="diff-file">{relative(get().root, info.path)}</span>
        <span className="toolbar-spacer" />
        <button className="ghost-btn small" onClick={() => openFile(info.path)}>
          Open File
        </button>
        {entry && staged && entry.x !== " " && entry.x !== "?" && (
          <button className="ghost-btn small" onClick={() => gitActions.unstage([info.path])}>
            Unstage
          </button>
        )}
        {entry && !staged && entry.y !== " " && (
          <button className="ghost-btn small" onClick={() => gitActions.stage([info.path])}>
            Stage
          </button>
        )}
      </div>
      {error ? <div className="diff-empty">{error}</div> : empty ? <div className="diff-empty">No changes</div> : null}
      <div className="diff-body" ref={host} style={{ display: error || empty ? "none" : undefined }} />
    </div>
  );
}
