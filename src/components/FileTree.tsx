import { memo, type MouseEvent } from "react";
import { ChevronRight } from "lucide-react";
import { useStore, set } from "../store";
import { fs, type Entry } from "../lib/fs";
import { copyPath, deleteEntries, deleteEntry, moveEntries, toggleDir as expandDir, newFile, newFolder, openDiff, openFile, openToSide, renameEntry, selectInTree, toggleDir, treeSelection } from "../actions";
import { FileIcon, FolderIcon } from "./FileIcon";
import { session } from "../editor/session";

function openMenu(e: MouseEvent, entry: Entry) {
  e.preventDefault();
  e.stopPropagation();
  const current = treeSelection();
  if (current.length > 1 && current.includes(entry.path)) {
    set({
      menu: {
        x: e.clientX,
        y: e.clientY,
        items: [
          { label: `Copy ${current.length} Paths`, run: () => navigator.clipboard.writeText(current.join("\n")) },
          "separator",
          { label: `Move ${current.length} Items to Trash`, shortcut: "⌘⌫", danger: true, run: () => deleteEntries(current) },
        ],
      },
    });
    return;
  }
  const change = useStore.getState().git.changes[entry.path];
  const fileItems = entry.is_dir
    ? []
    : [
        { label: "Open to the Side", run: () => openToSide(entry.path) },
        ...(change && change !== "U" && change !== "D" ? [{ label: "Open Changes", run: () => openDiff(entry.path) }] : []),
        "separator" as const,
      ];
  set({
    selected: entry.path,
    selection: [entry.path],
    selectionAnchor: null,
    menu: {
      x: e.clientX,
      y: e.clientY,
      items: [
        ...fileItems,
        { label: "New File", shortcut: "⌘N", run: () => newFile(entry.path) },
        { label: "New Folder", shortcut: "⇧⌘N", run: () => newFolder(entry.path) },
        "separator",
        { label: "Rename", run: () => renameEntry(entry.path) },
        { label: "Copy Path", run: () => copyPath(entry.path) },
        { label: "Copy Relative Path", run: () => copyPath(entry.path, true) },
        { label: "Reveal in Finder", run: () => fs.reveal(entry.path) },
        "separator",
        { label: "Move to Trash", shortcut: "⌘⌫", danger: true, run: () => deleteEntry(entry.path) },
      ],
    },
  });
}

type Drag = {
  paths: string[];
  startX: number;
  startY: number;
  active: boolean;
  ghost: HTMLElement | null;
  target: string | null;
  marked: HTMLElement | null;
  hoverTimer: number;
  hoverDir: string | null;
};

let drag: Drag | null = null;
let suppressClick = false;

function dirOfRow(row: HTMLElement) {
  const path = row.dataset.path!;
  return row.dataset.dir === "1" ? path : path.slice(0, path.lastIndexOf("/"));
}

function mark(el: HTMLElement | null) {
  if (!drag || drag.marked === el) return;
  drag.marked?.classList.remove("drop-target");
  el?.classList.add("drop-target");
  drag.marked = el;
}

function dropTargetAt(x: number, y: number): { dir: string; el: HTMLElement } | null {
  const hit = document.elementFromPoint(x, y) as HTMLElement | null;
  const tree = hit?.closest<HTMLElement>(".tree");
  if (!tree) return null;
  const row = hit!.closest<HTMLElement>(".tree-row");
  const root = useStore.getState().root;
  if (!row) return root ? { dir: root, el: tree } : null;
  const dir = dirOfRow(row);
  if (dir === root) return { dir, el: tree };
  const el = row.dataset.dir === "1" ? row : tree.querySelector<HTMLElement>(`.tree-row[data-path="${CSS.escape(dir)}"]`) ?? tree;
  return { dir, el };
}

function valid(dir: string, paths: string[]) {
  return paths.some((p) => p !== dir && !dir.startsWith(p + "/") && p.slice(0, p.lastIndexOf("/")) !== dir);
}

function onMove(e: globalThis.MouseEvent) {
  if (!drag) return;
  if (!drag.active) {
    if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 5) return;
    drag.active = true;
    const ghost = document.createElement("div");
    ghost.className = "tree-drag-ghost";
    ghost.textContent = drag.paths.length === 1 ? drag.paths[0].slice(drag.paths[0].lastIndexOf("/") + 1) : `${drag.paths.length} items`;
    document.body.appendChild(ghost);
    drag.ghost = ghost;
    document.body.classList.add("tree-dragging");
  }
  drag.ghost!.style.transform = `translate(${e.clientX + 12}px, ${e.clientY + 8}px)`;
  const hit = dropTargetAt(e.clientX, e.clientY);
  if (hit && valid(hit.dir, drag.paths)) {
    drag.target = hit.dir;
    mark(hit.el);
  } else {
    drag.target = null;
    mark(null);
  }
  const hoverDir = hit && hit.el.classList.contains("tree-row") ? hit.dir : null;
  if (hoverDir !== drag.hoverDir) {
    drag.hoverDir = hoverDir;
    window.clearTimeout(drag.hoverTimer);
    if (hoverDir && !useStore.getState().expanded[hoverDir]) {
      drag.hoverTimer = window.setTimeout(() => {
        if (drag?.hoverDir === hoverDir && !useStore.getState().expanded[hoverDir]) expandDir(hoverDir);
      }, 700);
    }
  }
}

function endDrag(drop: boolean) {
  window.removeEventListener("mousemove", onMove, true);
  window.removeEventListener("mouseup", onUp, true);
  window.removeEventListener("keydown", onKey, true);
  if (!drag) return;
  const { active, target, paths } = drag;
  window.clearTimeout(drag.hoverTimer);
  drag.ghost?.remove();
  mark(null);
  document.body.classList.remove("tree-dragging");
  drag = null;
  if (active) {
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 0);
    if (drop && target) moveEntries(paths, target);
  }
}

function onUp() {
  endDrag(true);
}

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape" && drag?.active) {
    e.preventDefault();
    e.stopPropagation();
    endDrag(false);
  }
}

function startDrag(e: MouseEvent, path: string) {
  if (e.button !== 0 || e.shiftKey || e.metaKey || e.ctrlKey) return;
  const current = treeSelection();
  const paths = current.length > 1 && current.includes(path) ? current : [path];
  drag = { paths, startX: e.clientX, startY: e.clientY, active: false, ghost: null, target: null, marked: null, hoverTimer: 0, hoverDir: null };
  window.addEventListener("mousemove", onMove, true);
  window.addEventListener("mouseup", onUp, true);
  window.addEventListener("keydown", onKey, true);
}

const Row = memo(function Row({ entry, depth }: { entry: Entry; depth: number }) {
  const open = useStore((s) => !!s.expanded[entry.path]);
  const selected = useStore((s) => (s.selection.length ? s.selection.includes(entry.path) : s.selected === entry.path));
  const active = useStore((s) => s.active === entry.path);
  const dirty = useStore((s) => s.tabs.some((t) => t.path === entry.path && t.dirty));
  const git = useStore((s) => (entry.is_dir ? (s.git.dirs[entry.path] ? "dir" : s.git.changes[entry.path]) : s.git.changes[entry.path]));

  return (
    <>
      <div
        className={`tree-row${selected ? " selected" : ""}${active ? " active" : ""}${git && git !== "dir" ? ` git-${git}` : ""}`}
        style={{ paddingLeft: 8 + depth * 16 }}
        data-path={entry.path}
        data-dir={entry.is_dir ? "1" : "0"}
        onMouseDown={(e) => {
          if (e.shiftKey) e.preventDefault();
          e.currentTarget.closest<HTMLElement>(".tree")?.focus();
          startDrag(e, entry.path);
        }}
        onClick={(e) => {
          if (suppressClick) return;
          if (e.shiftKey) return selectInTree(entry.path, "range");
          if (e.metaKey) return selectInTree(entry.path, "toggle");
          if (entry.is_dir) return toggleDir(entry.path);
          selectInTree(entry.path, "single");
          const tree = e.currentTarget.closest<HTMLElement>(".tree");
          openFile(entry.path).then(() => requestAnimationFrame(() => tree?.focus()));
        }}
        onDoubleClick={() => {
          if (!entry.is_dir) requestAnimationFrame(() => session.focus());
        }}
        onContextMenu={(e) => openMenu(e, entry)}
        title={entry.path}
      >
        <span className={`tree-chevron${open ? " open" : ""}`}>
          {entry.is_dir && <ChevronRight size={13} strokeWidth={2} />}
        </span>
        {entry.is_dir ? <FolderIcon name={entry.name} open={open} /> : <FileIcon path={entry.path} />}
        <span className="tree-name">{entry.name}</span>
        {dirty && <span className="dot" />}
        {git && <span className={`git-badge g-${git}`}>{git === "dir" ? "" : git}</span>}
      </div>
      {entry.is_dir && open && <Children path={entry.path} depth={depth + 1} />}
    </>
  );
});

export function Children({ path, depth }: { path: string; depth: number }) {
  const entries = useStore((s) => s.tree[path]);
  if (!entries) return null;
  return (
    <>
      {entries.map((e) => (
        <Row key={e.path} entry={e} depth={depth} />
      ))}
    </>
  );
}
