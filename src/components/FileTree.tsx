import { memo, type MouseEvent } from "react";
import { ChevronRight } from "lucide-react";
import { useStore, set } from "../store";
import { fs, type Entry } from "../lib/fs";
import { copyPath, deleteEntry, newFile, newFolder, openDiff, openFile, openToSide, renameEntry, toggleDir } from "../actions";
import { FileIcon, FolderIcon } from "./FileIcon";

function openMenu(e: MouseEvent, entry: Entry) {
  e.preventDefault();
  e.stopPropagation();
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
        { label: "Move to Trash", danger: true, run: () => deleteEntry(entry.path) },
      ],
    },
  });
}

const Row = memo(function Row({ entry, depth }: { entry: Entry; depth: number }) {
  const open = useStore((s) => !!s.expanded[entry.path]);
  const selected = useStore((s) => s.selected === entry.path);
  const active = useStore((s) => s.active === entry.path);
  const dirty = useStore((s) => s.tabs.some((t) => t.path === entry.path && t.dirty));
  const git = useStore((s) => (entry.is_dir ? (s.git.dirs[entry.path] ? "dir" : s.git.changes[entry.path]) : s.git.changes[entry.path]));

  return (
    <>
      <div
        className={`tree-row${selected ? " selected" : ""}${active ? " active" : ""}${git && git !== "dir" ? ` git-${git}` : ""}`}
        style={{ paddingLeft: 8 + depth * 16 }}
        onClick={() => (entry.is_dir ? toggleDir(entry.path) : (set({ selected: entry.path }), openFile(entry.path)))}
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
