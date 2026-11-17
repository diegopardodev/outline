import { useState } from "react";
import { X } from "lucide-react";
import { useStore, set } from "../store";
import { activate, closeAll, closeOthers, closeTab, copyPath, moveTab, openToSide } from "../actions";
import { fs } from "../lib/fs";
import { FileIcon } from "./FileIcon";
import { bindingLabel } from "../commands";

export function Tabs() {
  const tabs = useStore((s) => s.tabs);
  const active = useStore((s) => s.active);
  const [dragging, setDragging] = useState<string | null>(null);

  if (!tabs.length) return null;

  const dupes = new Set(tabs.map((t) => t.name).filter((n, i, all) => all.indexOf(n) !== i));

  return (
    <div className="tabbar">
      {tabs.map((t) => {
        const parent = t.path.split("/").slice(-2, -1)[0];
        return (
          <div
            key={t.path}
            className={`tab${t.path === active ? " active" : ""}${t.dirty ? " dirty" : ""}${dragging === t.path ? " dragging" : ""}`}
            title={t.path}
            draggable
            onDragStart={() => setDragging(t.path)}
            onDragEnd={() => setDragging(null)}
            onDragOver={(e) => {
              e.preventDefault();
              if (dragging && dragging !== t.path) moveTab(dragging, t.path);
            }}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                closeTab(t.path);
              } else if (e.button === 0) activate(t.path);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              set({
                menu: {
                  x: e.clientX,
                  y: e.clientY,
                  items: [
                    { label: "Close", shortcut: bindingLabel("close-tab"), run: () => closeTab(t.path) },
                    { label: "Close Others", run: () => closeOthers(t.path) },
                    { label: "Close All", run: closeAll },
                    "separator",
                    { label: "Open to the Side", run: () => openToSide(t.path) },
                    "separator",
                    { label: "Copy Path", run: () => copyPath(t.path) },
                    { label: "Copy Relative Path", run: () => copyPath(t.path, true) },
                    { label: "Reveal in Finder", run: () => fs.reveal(t.path) },
                  ],
                },
              });
            }}
          >
            <FileIcon path={t.path} size={14} />
            <span className="tab-name">{t.name}</span>
            {dupes.has(t.name) && parent && <span className="tab-hint">{parent}</span>}
            <button
              className="tab-close"
              title={bindingLabel("close-tab") ? `Close (${bindingLabel("close-tab")})` : "Close"}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                closeTab(t.path);
              }}
            >
              <span className="tab-dot" />
              <X size={12} strokeWidth={2} className="tab-x" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
