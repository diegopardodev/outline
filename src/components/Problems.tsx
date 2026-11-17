import { useMemo, useState } from "react";
import { ChevronRight, CircleAlert, Info, TriangleAlert } from "lucide-react";
import { useStore, type Problem } from "../store";
import { basename, dirname, relative } from "../lib/fs";
import { openMatch } from "../actions";
import { FileIcon } from "./FileIcon";

export function useProblemCounts() {
  const problems = useStore((s) => s.problems);
  return useMemo(() => {
    let errors = 0;
    let warnings = 0;
    for (const list of Object.values(problems)) {
      for (const p of list) {
        if (p.severity === 1) errors++;
        else if (p.severity === 2) warnings++;
      }
    }
    return { errors, warnings };
  }, [problems]);
}

function SeverityIcon({ severity }: { severity: Problem["severity"] }) {
  if (severity === 1) return <CircleAlert size={14} strokeWidth={1.9} className="sev sev-error" />;
  if (severity === 2) return <TriangleAlert size={14} strokeWidth={1.9} className="sev sev-warning" />;
  return <Info size={14} strokeWidth={1.9} className="sev sev-info" />;
}

export function ProblemsList() {
  const problems = useStore((s) => s.problems);
  const root = useStore((s) => s.root);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const files = useMemo(
    () =>
      Object.entries(problems)
        .map(([path, list]) => ({
          path,
          list: [...list].filter((p) => p.severity <= 3).sort((a, b) => a.severity - b.severity || a.line - b.line || a.col - b.col),
        }))
        .filter((f) => f.list.length)
        .sort((a, b) => a.path.localeCompare(b.path)),
    [problems],
  );

  if (!files.length) return <div className="problems-empty">No problems in open files.</div>;

  return (
    <div className="problems">
      {files.map(({ path, list }) => {
        const dir = relative(root, dirname(path));
        return (
          <div key={path} className="prob-file">
            <div className="prob-file-head" onClick={() => setCollapsed((c) => ({ ...c, [path]: !c[path] }))}>
              <ChevronRight size={13} strokeWidth={2} className={collapsed[path] ? "chev" : "chev open"} />
              <FileIcon path={path} size={14} />
              <span className="prob-name">{basename(path)}</span>
              {dir !== root && <span className="prob-dir">{dir}</span>}
              <span className="prob-count">{list.length}</span>
            </div>
            {!collapsed[path] &&
              list.map((p, i) => (
                <div key={i} className="prob-row" onClick={() => openMatch(path, p.line + 1, p.col, 0)} title={p.message}>
                  <SeverityIcon severity={p.severity} />
                  <span className="prob-msg">{p.message}</span>
                  {p.source && (
                    <span className="prob-src">
                      {p.source}
                      {p.code ? `(${p.code})` : ""}
                    </span>
                  )}
                  <span className="prob-pos">
                    [Ln {p.line + 1}, Col {p.col + 1}]
                  </span>
                </div>
              ))}
          </div>
        );
      })}
    </div>
  );
}
