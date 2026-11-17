import { useRef, type PointerEvent } from "react";
import { FilePlus2, FolderOpen, FolderPlus, ListCollapse, PanelLeft } from "lucide-react";
import { useStore, set } from "../store";
import { basename } from "../lib/fs";
import { collapseAll, newFile, newFolder, openFolder, toggleSidebar } from "../actions";
import { session } from "../editor/session";
import { Children } from "./FileTree";
import { SearchPanel } from "./SearchPanel";
import { GitPanel } from "./GitPanel";

export function Sidebar() {
  const root = useStore((s) => s.root);
  const width = useStore((s) => s.sidebarWidth);
  const mode = useStore((s) => s.sidebarMode);
  const changeCount = useStore((s) => s.git.entries.length);
  const isRepo = useStore((s) => !!s.git.top);
  const drag = useRef<{ x: number; w: number } | null>(null);

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = { x: e.clientX, w: width };
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.classList.add("resizing");
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    set({ sidebarWidth: Math.max(200, Math.min(520, drag.current.w + e.clientX - drag.current.x)) });
  };
  const onUp = () => {
    drag.current = null;
    document.body.classList.remove("resizing");
    session.remeasure();
  };

  return (
    <aside className="sidebar" style={{ width }}>
      <div className="sidebar-top" data-tauri-drag-region>
        <button className="tool-btn round" title="Hide Sidebar (⌘B)" onClick={toggleSidebar}>
          <PanelLeft size={16} strokeWidth={1.6} />
        </button>
      </div>
      <div className="segmented">
        <button className={mode === "files" ? "on" : ""} onClick={() => set({ sidebarMode: "files" })}>
          Files
        </button>
        <button
          className={mode === "search" ? "on" : ""}
          onClick={() => set((s) => ({ sidebarMode: "search", search: { ...s.search, focusToken: s.search.focusToken + 1 } }))}
        >
          Search
        </button>
        {isRepo && (
          <button className={mode === "git" ? "on" : ""} onClick={() => set({ sidebarMode: "git" })}>
            Changes{changeCount > 0 && <span className="seg-count">{changeCount}</span>}
          </button>
        )}
      </div>
      {mode === "git" ? (
        <GitPanel />
      ) : mode === "search" ? (
        <SearchPanel />
      ) : root ? (
        <>
          <div className="sidebar-head">
            <span className="section-label" title={root}>
              {basename(root)}
            </span>
            <div className="sidebar-actions">
              <button className="icon-btn" title="New File (⌘N)" onClick={() => newFile(root)}>
                <FilePlus2 size={14} strokeWidth={1.7} />
              </button>
              <button className="icon-btn" title="New Folder (⇧⌘N)" onClick={() => newFolder(root)}>
                <FolderPlus size={14} strokeWidth={1.7} />
              </button>
              <button className="icon-btn" title="Collapse Folders" onClick={collapseAll}>
                <ListCollapse size={14} strokeWidth={1.7} />
              </button>
            </div>
          </div>
          <div
            className="tree"
            onContextMenu={(e) => {
              e.preventDefault();
              set({
                selected: null,
                menu: {
                  x: e.clientX,
                  y: e.clientY,
                  items: [
                    { label: "New File", shortcut: "⌘N", run: () => newFile(root) },
                    { label: "New Folder", shortcut: "⇧⌘N", run: () => newFolder(root) },
                  ],
                },
              });
            }}
          >
            <Children path={root} depth={0} />
          </div>
        </>
      ) : (
        <div className="sidebar-empty">
          <button className="ghost-btn" onClick={openFolder}>
            <FolderOpen size={14} strokeWidth={1.75} />
            Open Folder
          </button>
        </div>
      )}
      <div className="resizer" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} />
    </aside>
  );
}
