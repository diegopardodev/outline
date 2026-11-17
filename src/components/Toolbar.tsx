import {
  ChevronLeft,
  ChevronRight,
  Columns2,
  Command,
  PanelLeft,
  Search,
  SquareTerminal,
} from "lucide-react";
import { useStore, set } from "../store";
import { basename, tildify } from "../lib/fs";
import { navigate, showSearch, toggleSidebar, toggleSplit } from "../actions";
import { toggleTerminal } from "../terminal/manager";
import { bindingLabel } from "../commands";

const tip = (label: string, id: string) => {
  const key = bindingLabel(id);
  return key ? `${label} (${key})` : label;
};

export function Toolbar() {
  const root = useStore((s) => s.root);
  const sidebar = useStore((s) => s.sidebarVisible);
  const branch = useStore((s) => s.git.branch);
  const changes = useStore((s) => Object.keys(s.git.changes).length);
  const unsaved = useStore((s) => s.tabs.filter((t) => t.dirty).length);
  const canBack = useStore((s) => s.history.index > 0);
  const canForward = useStore((s) => s.history.index < s.history.stack.length - 1);
  const terminalOpen = useStore((s) => s.terminalOpen);
  const searchOpen = useStore((s) => s.sidebarVisible && s.sidebarMode === "search");
  const split = useStore((s) => !!s.split);
  const hasActive = useStore((s) => !!s.active);

  const subtitle = [
    branch ? `${changes === 0 ? "clean" : `${changes} change${changes === 1 ? "" : "s"}`}` : root ? tildify(root) : null,
    unsaved ? `${unsaved} unsaved` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <header className={`toolbar${sidebar ? "" : " no-sidebar"}`} data-tauri-drag-region>
      {!sidebar && (
        <button className="tool-btn" title={tip("Show Sidebar", "toggle-sidebar")} onClick={toggleSidebar}>
          <PanelLeft size={16} strokeWidth={1.6} />
        </button>
      )}
      <div className="pill-group">
        <button className="tool-btn" disabled={!canBack} title={tip("Go Back", "back")} onClick={() => navigate(-1)}>
          <ChevronLeft size={17} strokeWidth={1.7} />
        </button>
        <button className="tool-btn" disabled={!canForward} title={tip("Go Forward", "forward")} onClick={() => navigate(1)}>
          <ChevronRight size={17} strokeWidth={1.7} />
        </button>
      </div>
      <div className="title-block" data-tauri-drag-region>
        <div className="title" data-tauri-drag-region>
          {root ? basename(root) : "Outline"}
        </div>
        {subtitle && (
          <div className="subtitle" data-tauri-drag-region>
            {subtitle}
          </div>
        )}
      </div>
      <div className="toolbar-spacer" data-tauri-drag-region />
      <div className="pill-group">
        <button className={`tool-btn${split ? " on" : ""}`} disabled={!hasActive && !split} title={tip("Split Editor", "split")} onClick={toggleSplit}>
          <Columns2 size={15} strokeWidth={1.6} />
        </button>
        <button className={`tool-btn${terminalOpen ? " on" : ""}`} title={tip("Toggle Terminal", "terminal")} onClick={toggleTerminal}>
          <SquareTerminal size={16} strokeWidth={1.6} />
        </button>
        <button className={`tool-btn${searchOpen ? " on" : ""}`} title={tip("Search in Project", "search")} onClick={() => showSearch()}>
          <Search size={16} strokeWidth={1.7} />
        </button>
        <button className="tool-btn" title={tip("Commands", "commands")} onClick={() => set({ palette: "commands" })}>
          <Command size={15} strokeWidth={1.7} />
        </button>
      </div>
    </header>
  );
}
