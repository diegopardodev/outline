import { useEffect, useRef } from "react";
import { CaseSensitive, ChevronRight, Regex, Replace, ReplaceAll, Search, WholeWord, X } from "lucide-react";
import { useStore } from "../store";
import { basename, relative } from "../lib/fs";
import {
  openMatch,
  replaceAll,
  replaceInFile,
  replaceMatch,
  runSearch,
  setReplaceText,
  setSearchQuery,
  toggleReplace,
  toggleSearchCollapsed,
  toggleSearchOption,
} from "../actions";
import { FileIcon } from "./FileIcon";

export function SearchPanel() {
  const root = useStore((s) => s.root);
  const search = useStore((s) => s.search);
  const input = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const { query, replace, replaceOpen, options, result, loading, error, collapsed } = search;

  useEffect(() => {
    const target = search.focusField === "replace" ? replaceInput.current : input.current;
    target?.focus();
    target?.select();
  }, [search.focusToken]);

  if (!root) return <div className="search-empty">Open a folder to search its files.</div>;

  const files = result?.files ?? [];
  const canReplace = replaceOpen && !!query && files.length > 0;
  // A regex replacement with $1-style references can't be previewed without running
  // the regex, so the preview only shows when the replacement is literal text.
  const preview = replaceOpen && !!query && (!options.regex || !replace.includes("$"));

  return (
    <div className="search-panel">
      <div className="search-form">
        <button
          className={`search-expand${replaceOpen ? " open" : ""}`}
          title={replaceOpen ? "Hide Replace" : "Show Replace"}
          aria-expanded={replaceOpen}
          onClick={toggleReplace}
        >
          <ChevronRight size={13} strokeWidth={2} />
        </button>
        <div className="search-fields">
          <div className="search-box">
            <Search size={14} strokeWidth={1.8} className="search-icon" />
            <input
              ref={input}
              spellCheck={false}
              placeholder="Search project"
              value={query}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") runSearch();
                if (e.key === "Escape" && query) setSearchQuery("");
              }}
            />
            {query && (
              <button className="search-clear" title="Clear" onClick={() => setSearchQuery("")}>
                <X size={12} strokeWidth={2.2} />
              </button>
            )}
            <div className="search-toggles">
              <button className={options.caseSensitive ? "on" : ""} title="Match Case" onClick={() => toggleSearchOption("caseSensitive")}>
                <CaseSensitive size={15} strokeWidth={1.8} />
              </button>
              <button className={options.wholeWord ? "on" : ""} title="Match Whole Word" onClick={() => toggleSearchOption("wholeWord")}>
                <WholeWord size={15} strokeWidth={1.8} />
              </button>
              <button className={options.regex ? "on" : ""} title="Use Regular Expression" onClick={() => toggleSearchOption("regex")}>
                <Regex size={14} strokeWidth={1.8} />
              </button>
            </div>
          </div>
          {replaceOpen && (
            <div className="search-box">
              <Replace size={14} strokeWidth={1.8} className="search-icon" />
              <input
                ref={replaceInput}
                spellCheck={false}
                placeholder={options.regex ? "Replace ($1 for groups)" : "Replace"}
                value={replace}
                onChange={(e) => setReplaceText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && e.metaKey) {
                    e.preventDefault();
                    replaceAll();
                  }
                  if (e.key === "Escape" && replace) setReplaceText("");
                }}
              />
              <div className="search-toggles">
                <button title="Replace All (⌘↩)" disabled={!canReplace} onClick={replaceAll}>
                  <ReplaceAll size={15} strokeWidth={1.8} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="search-summary">
        {error ? (
          <span className="error">{error}</span>
        ) : loading && !result ? (
          "Searching…"
        ) : result && query ? (
          result.total === 0 ? (
            "No results"
          ) : (
            <>
              {result.total.toLocaleString()} result{result.total === 1 ? "" : "s"} in {files.length} file{files.length === 1 ? "" : "s"}
              {result.truncated && " (limited)"}
            </>
          )
        ) : null}
        {loading && <span className="spinner" />}
      </div>

      <div className="search-results">
        {files.map((f) => {
          const rel = relative(root, f.path);
          const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
          const isOpen = !collapsed[f.path];
          return (
            <div key={f.path} className="sr-file">
              <div className="sr-head" onClick={() => toggleSearchCollapsed(f.path)} title={rel}>
                <span className={`tree-chevron${isOpen ? " open" : ""}`}>
                  <ChevronRight size={13} strokeWidth={2} />
                </span>
                <FileIcon path={f.path} size={15} />
                <span className="sr-name">{basename(f.path)}</span>
                <span className="sr-dir">{dir}</span>
                {replaceOpen && (
                  <button
                    className="icon-btn sr-action"
                    title="Replace All in File"
                    onClick={(e) => {
                      e.stopPropagation();
                      replaceInFile(f.path);
                    }}
                  >
                    <ReplaceAll size={13} strokeWidth={1.8} />
                  </button>
                )}
                <span className="sr-count">{f.matches.length}</span>
              </div>
              {isOpen &&
                f.matches.map((m, i) => (
                  <div key={i} className="sr-line" onClick={() => openMatch(f.path, m.line, m.col, m.len)} title={`Line ${m.line}`}>
                    <span className="sr-ln">{m.line}</span>
                    <span className="sr-text">
                      {m.before}
                      {preview ? (
                        <>
                          <del>{m.text}</del>
                          {replace && <ins>{replace}</ins>}
                        </>
                      ) : (
                        <mark>{m.text}</mark>
                      )}
                      {m.after}
                    </span>
                    {replaceOpen && (
                      <button
                        className="icon-btn sr-action"
                        title="Replace"
                        onClick={(e) => {
                          e.stopPropagation();
                          replaceMatch(f.path, m.line, m.col);
                        }}
                      >
                        <Replace size={13} strokeWidth={1.8} />
                      </button>
                    )}
                  </div>
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
