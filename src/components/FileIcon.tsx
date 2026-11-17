import { basename } from "../lib/fs";
import { fileIconUrl, folderIconUrl } from "../lib/icons";
import { useStore } from "../store";

export function FileIcon({ path, size = 16 }: { path: string; size?: number }) {
  const dark = useStore((s) => s.dark);
  return <img className="file-icon" src={fileIconUrl(basename(path), dark)} width={size} height={size} alt="" draggable={false} />;
}

export function FolderIcon({ name, open, size = 16 }: { name: string; open: boolean; size?: number }) {
  const dark = useStore((s) => s.dark);
  useStore((s) => s.iconsVersion);
  return <img className="folder-icon" src={folderIconUrl(name, open, dark)} width={size} height={size} alt="" draggable={false} />;
}
