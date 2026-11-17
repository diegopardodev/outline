import { useLayoutEffect, useRef } from "react";
import { X } from "lucide-react";
import { get, set, useStore } from "../store";
import { session } from "../editor/session";
import { focusPane, showIn } from "../actions";
import { Welcome } from "./Welcome";
import { ImagePreview } from "./ImagePreview";
import { DiffView } from "./DiffView";
import { MarkdownPreview } from "./MarkdownPreview";
import { FileIcon } from "./FileIcon";

export function EditorPane() {
  const split = useStore((s) => !!s.split);
  return (
    <div className={`editor-split${split ? " is-split" : ""}`}>
      <Pane pane={0} />
      {split && <Pane pane={1} />}
    </div>
  );
}

function closePane(pane: 0 | 1) {
  const s = get();
  if (!s.split) return;
  const keep = pane === 1 ? s.split.left : s.split.right;
  set({ split: null, active: keep });
  session.setFocused(0);
  showIn(0, keep);
}

function Pane({ pane }: { pane: 0 | 1 }) {
  const host = useRef<HTMLDivElement>(null);
  const split = useStore((s) => s.split);
  const path = useStore((s) => (s.split ? (pane === 1 ? s.split.right : s.split.left) : s.active));
  const tab = useStore((s) => s.tabs.find((t) => t.path === path));
  const md = useStore((s) => !!(path && s.mdPreview[path]));
  const kind = tab?.kind;
  const focused = !split || split.focus === pane;

  useLayoutEffect(() => {
    if (!host.current) return;
    if (pane === 0) {
      session.mount(host.current);
      return;
    }
    session.mountSecondary(host.current);
    showIn(1, get().split?.right ?? null);
    session.setFocused(1);
    requestAnimationFrame(() => session.focus());
    return () => session.unmountSecondary();
  }, [pane]);

  return (
    <div
      className={`pane${split ? " in-split" : ""}${split && focused ? " focused" : ""}`}
      onMouseDownCapture={() => split && !focused && focusPane(pane, false)}
    >
      {split && (
        <div className="pane-head">
          {tab ? <FileIcon path={tab.path} size={13} /> : null}
          <span className="pane-name">{tab?.name ?? "Empty"}</span>
          {tab?.dirty && <span className="pane-dirty" />}
          <button className="icon-btn pane-close" title="Close Pane" onClick={() => closePane(pane)}>
            <X size={12} strokeWidth={2} />
          </button>
        </div>
      )}
      <div className="pane-body">
        <div className="editor-wrap">
          <div ref={host} className="editor-host" style={{ visibility: path && tab && !kind ? "visible" : "hidden" }} />
          {path && kind === "image" && <ImagePreview key={path} path={path} />}
          {path && kind === "diff" && <DiffView key={path} tab={path} />}
          {!path && pane === 0 && <Welcome />}
        </div>
        {md && path && !kind && <MarkdownPreview key={path} path={path} pane={pane} />}
      </div>
    </div>
  );
}
