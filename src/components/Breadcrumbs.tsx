import { useStore, set } from "../store";
import { languageName } from "../lib/languages";
import { basename, relative } from "../lib/fs";
import { toggleMarkdownPreview, togglePreview, toggleWrap } from "../actions";
import { parseDiffPath } from "../lib/diffpath";
import { formatBytes, imageFormat, isSvg } from "../lib/media";

export function Breadcrumbs() {
  const active = useStore((s) => s.active);
  const root = useStore((s) => s.root);
  const cursor = useStore((s) => s.cursor);
  const indent = useStore((s) => s.indent);
  const wrap = useStore((s) => s.wrap);
  const statusBar = useStore((s) => s.statusBar);
  const media = useStore((s) => s.media);
  const image = useStore((s) => s.tabs.some((t) => t.path === s.active && t.kind === "image"));
  const mdOpen = useStore((s) => !!(s.active && s.mdPreview[s.active]));

  if (!active) return null;

  const diff = parseDiffPath(active);
  const file = diff?.path ?? active;
  const crumbs = relative(root, file).split("/");
  if (root && file.startsWith(root + "/")) crumbs.unshift(basename(root));
  const markdown = /\.(md|markdown|mdx)$/i.test(active);

  if (diff) {
    return (
      <div className="crumbbar">
        <div className="crumbs">
          {crumbs.map((c, i) => (
            <span key={i} className={i === crumbs.length - 1 ? "crumb last" : "crumb"}>
              {c}
            </span>
          ))}
        </div>
        <div className="crumb-meta">
          <span>{diff.side === "staged" ? "HEAD ↔ Index" : "Index ↔ Working Tree"}</span>
          <span className="sep">·</span>
          <span className="lang">{languageName(file)}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="crumbbar">
      <div className="crumbs">
        {crumbs.map((c, i) => (
          <span key={i} className={i === crumbs.length - 1 ? "crumb last" : "crumb"}>
            {c}
          </span>
        ))}
      </div>
      {image ? (
        <div className="crumb-meta">
          {media?.path === active && media.width > 0 && (
            <>
              <span>
                {media.width} × {media.height}
              </span>
              <span className="sep">·</span>
            </>
          )}
          {media?.path === active && media.bytes > 0 && (
            <>
              <span>{formatBytes(media.bytes)}</span>
              <span className="sep">·</span>
            </>
          )}
          <span className="lang">{imageFormat(active)}</span>
          {isSvg(active) && (
            <>
              <span className="sep">·</span>
              <button onClick={() => togglePreview(active)} title="Show the SVG source">
                Show Code
              </button>
            </>
          )}
        </div>
      ) : (
      <div className="crumb-meta">
        {markdown && (
          <>
            <button onClick={() => toggleMarkdownPreview(active)} title="Toggle Markdown Preview (⇧⌘V)">
              {mdOpen ? "Hide Preview" : "Show Preview"}
            </button>
            <span className="sep">·</span>
          </>
        )}
        {isSvg(active) && (
          <>
            <button onClick={() => togglePreview(active)} title="Preview the SVG">
              Show Preview
            </button>
            <span className="sep">·</span>
          </>
        )}
        {/* The status bar shows these when it's visible. */}
        {!statusBar && (
          <>
            <button onClick={() => set({ palette: "line" })} title="Go to Line (⌃G)">
              Ln {cursor.line}, Col {cursor.col}
              {cursor.selected > 0 && <span className="faint"> ({cursor.selected} selected)</span>}
            </button>
            <span className="sep">·</span>
            <span>{indent}</span>
            <span className="sep">·</span>
          </>
        )}
        <button onClick={toggleWrap} title="Toggle Word Wrap (⌥Z)">
          {wrap ? "Wrap" : "No Wrap"}
        </button>
        <span className="sep">·</span>
        {!statusBar && (
          <>
            <span className="lang">{languageName(active)}</span>
            <span className="sep">·</span>
          </>
        )}
        <span className="faint">
          {cursor.lines.toLocaleString()} line{cursor.lines === 1 ? "" : "s"}
        </span>
      </div>
      )}
    </div>
  );
}
