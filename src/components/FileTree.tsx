import { memo, type MouseEvent } from "react";
import { ChevronRight } from "lucide-react";
import { useStore, set } from "../store";
import { fs, type Entry } from "../lib/fs";
import { copyPath, deleteEntries, deleteEntry, newFile, newFolder, openDiff, openFile, openToSide, renameEntry, selectInTree, toggleDir, treeSelection } from "../actions";
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
        onMouseDown={(e) => {
          if (e.shiftKey) e.preventDefault();
          e.currentTarget.closest<HTMLElement>(".tree")?.focus();
        }}
        onClick={(e) => {
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
