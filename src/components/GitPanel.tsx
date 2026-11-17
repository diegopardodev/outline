import { ArrowDown, ArrowUp, Check, FileText, Minus, Plus, RefreshCw, Undo2 } from "lucide-react";
import { set, useStore, type GitEntry } from "../store";
import { basename, dirname, relative } from "../lib/fs";
import { gitActions, openDiff, openFile, refreshGit } from "../actions";
import { FileIcon } from "./FileIcon";

const labels: Record<string, string> = {
  M: "Modified",
  A: "Added",
  D: "Deleted",
  R: "Renamed",
  C: "Copied",
  U: "Untracked",
  "!": "Conflict",
};

function letter(code: string) {
  return code === "?" ? "U" : code;
}

function Row({ entry, staged }: { entry: GitEntry; staged: boolean }) {
  const root = useStore((s) => s.root);
  const code = letter(staged ? entry.x : entry.y);
  const conflict = entry.x === "U" || entry.y === "U";
  const shown = conflict ? "!" : code;
  const dir = relative(root, dirname(entry.path));
  const deleted = code === "D";
  return (
    <div
      className={`git-row s-${shown === "!" ? "C" : shown}`}
      title={`${relative(root, entry.path)} · ${labels[shown] ?? shown}`}
      onClick={() => (deleted || code === "U" ? openFile(entry.path) : openDiff(entry.path, staged ? "staged" : "work"))}
      onContextMenu={(e) => {
        e.preventDefault();
        set({
          menu: {
            x: e.clientX,
            y: e.clientY,
            items: [
              { label: "Open Changes", run: () => openDiff(entry.path, staged ? "staged" : "work") },
              { label: "Open File", run: () => openFile(entry.path) },
              "separator",
              staged
                ? { label: "Unstage Changes", run: () => gitActions.unstage([entry.path]) }
                : { label: "Stage Changes", run: () => gitActions.stage([entry.path]) },
              ...(staged ? [] : [{ label: "Discard Changes", danger: true, run: () => gitActions.discard([entry.path]) }]),
            ],
          },
        });
      }}
    >
      <FileIcon path={entry.path} size={14} />
      <span className={`git-name${deleted ? " deleted" : ""}`}>{basename(entry.path)}</span>
      {dir && dir !== "." && <span className="git-dir">{dir === root ? "" : dir}</span>}
      <span className="git-actions">
        {!deleted && (
          <button
            className="icon-btn"
            title="Open File"
            onClick={(e) => {
              e.stopPropagation();
              openFile(entry.path);
            }}
          >
            <FileText size={13} strokeWidth={1.7} />
          </button>
        )}
        {staged ? (
          <button
            className="icon-btn"
            title="Unstage"
            onClick={(e) => {
              e.stopPropagation();
              gitActions.unstage([entry.path]);
            }}
          >
            <Minus size={14} strokeWidth={1.9} />
          </button>
        ) : (
          <>
            <button
              className="icon-btn"
              title="Discard Changes"
              onClick={(e) => {
                e.stopPropagation();
                gitActions.discard([entry.path]);
              }}
            >
              <Undo2 size={13} strokeWidth={1.8} />
            </button>
            <button
              className="icon-btn"
              title="Stage"
              onClick={(e) => {
                e.stopPropagation();
                gitActions.stage([entry.path]);
              }}
            >
              <Plus size={14} strokeWidth={1.9} />
            </button>
          </>
        )}
      </span>
      <span className="git-code">{shown}</span>
    </div>
  );
}

export function GitPanel() {
  const git = useStore((s) => s.git);
  const root = useStore((s) => s.root);

  if (!root) return <div className="search-empty">Open a folder to see its changes.</div>;
  if (!git.top) return <div className="search-empty">This folder isn't a Git repository.</div>;

  const staged = git.entries.filter((e) => e.x !== " " && e.x !== "?");
  const changes = git.entries.filter((e) => e.y !== " ");
  const canCommit = git.message.trim().length > 0 && (staged.length > 0 || changes.length > 0) && !git.busy;

  return (
    <div className="git-panel">
      <div className="git-branch-row">
        <span className="git-branch-name" title={git.upstream ? `Tracking ${git.upstream}` : "No upstream branch"}>
          {git.branch ?? "detached"}
        </span>
        <span className="toolbar-spacer" />
        <button className="icon-btn" title="Refresh" onClick={() => refreshGit()}>
          <RefreshCw size={13} strokeWidth={1.8} className={git.busy ? "spin" : undefined} />
        </button>
        <button
          className="git-sync"
          disabled={!!git.busy}
          title={git.upstream ? `Pull ${git.behind} and push ${git.ahead} commit(s)` : "Publish this branch to origin"}
          onClick={() => (git.upstream ? gitActions.sync() : gitActions.push())}
        >
          {git.upstream ? (
            <>
              <ArrowDown size={12} strokeWidth={2} />
              {git.behind}
              <ArrowUp size={12} strokeWidth={2} />
              {git.ahead}
            </>
          ) : (
            "Publish"
          )}
        </button>
      </div>
      <div className="git-commit">
        <textarea
          spellCheck={false}
          rows={3}
          placeholder={`Message (⌘↩ to commit on “${git.branch ?? "HEAD"}”)`}
          value={git.message}
          onChange={(e) => set((s) => ({ git: { ...s.git, message: e.target.value } }))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.metaKey) {
              e.preventDefault();
              if (canCommit) gitActions.commit(staged.length === 0);
            }
          }}
        />
        <button className="btn primary git-commit-btn" disabled={!canCommit} onClick={() => gitActions.commit(staged.length === 0)}>
          <Check size={14} strokeWidth={2} />
          {git.busy ? `${git.busy}…` : staged.length ? "Commit" : "Commit All"}
        </button>
      </div>
      <div className="git-lists">
        {staged.length > 0 && (
          <section>
            <div className="git-section">
              <span>Staged Changes</span>
              <span className="git-count">{staged.length}</span>
              <span className="git-section-actions">
                <button className="icon-btn" title="Unstage All" onClick={() => gitActions.unstage(staged.map((e) => e.path))}>
                  <Minus size={14} strokeWidth={1.9} />
                </button>
              </span>
            </div>
            {staged.map((e) => (
              <Row key={"s" + e.path} entry={e} staged />
            ))}
          </section>
        )}
        <section>
          <div className="git-section">
            <span>Changes</span>
            <span className="git-count">{changes.length}</span>
            {changes.length > 0 && (
              <span className="git-section-actions">
                <button className="icon-btn" title="Discard All Changes" onClick={() => gitActions.discard(changes.map((e) => e.path))}>
                  <Undo2 size={13} strokeWidth={1.8} />
                </button>
                <button className="icon-btn" title="Stage All Changes" onClick={() => gitActions.stage(changes.map((e) => e.path))}>
                  <Plus size={14} strokeWidth={1.9} />
                </button>
              </span>
            )}
          </div>
          {changes.map((e) => (
            <Row key={"c" + e.path} entry={e} staged={false} />
          ))}
          {changes.length === 0 && staged.length === 0 && <div className="git-clean">No changes. Working tree is clean.</div>}
        </section>
      </div>
    </div>
  );
}
