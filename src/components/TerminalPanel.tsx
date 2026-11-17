import { useEffect, useLayoutEffect, useRef, type PointerEvent } from "react";
import { ChevronDown, Plus, SquareTerminal, Trash2 } from "lucide-react";
import { ProblemsList, useProblemCounts } from "./Problems";
import { useStore, set } from "../store";
import { attachTerminal, closeTerminal, createTerminal, fitTerminal, setTerminalFont } from "../terminal/manager";
import { session } from "../editor/session";

export function TerminalPanel() {
  const terminals = useStore((s) => s.terminals);
  const active = useStore((s) => s.activeTerminal);
  const height = useStore((s) => s.terminalHeight);
  const font = useStore((s) => s.editorFont);
  const tab = useStore((s) => s.panelTab);
  const counts = useProblemCounts();
  const host = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; h: number } | null>(null);

  useLayoutEffect(() => {
    if (tab === "terminal" && host.current && active != null) attachTerminal(active, host.current);
  }, [active, tab]);

  useEffect(() => setTerminalFont(font), [font]);

  useEffect(() => {
    if (!host.current) return;
    const ro = new ResizeObserver(() => fitTerminal(useStore.getState().activeTerminal));
    ro.observe(host.current);
    return () => ro.disconnect();
  }, []);

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = { y: e.clientY, h: height };
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.classList.add("resizing-y");
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const max = window.innerHeight - 220;
    set({ terminalHeight: Math.max(120, Math.min(max, drag.current.h - (e.clientY - drag.current.y))) });
  };
  const onUp = () => {
    drag.current = null;
    document.body.classList.remove("resizing-y");
    session.remeasure();
  };

  return (
    <section className="terminal-panel" style={{ height }}>
      <div className="resizer-y" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} />
      <div className="term-head">
        <div className="panel-switch">
          <button
            className={tab === "terminal" ? "on" : ""}
            onClick={() => {
              set({ panelTab: "terminal" });
              if (!terminals.length) createTerminal();
            }}
          >
            Terminal
          </button>
          <button className={tab === "problems" ? "on" : ""} onClick={() => set({ panelTab: "problems" })}>
            Problems
            {counts.errors + counts.warnings > 0 && <span className="seg-count">{counts.errors + counts.warnings}</span>}
          </button>
        </div>
        <div className="term-tabs" style={{ display: tab === "terminal" ? undefined : "none" }}>
          {terminals.map((t, i) => (
            <button
              key={t.id}
              className={`term-tab${t.id === active ? " on" : ""}${t.exited ? " exited" : ""}`}
              onClick={() => set({ activeTerminal: t.id })}
            >
              <SquareTerminal size={13} strokeWidth={1.7} />
              {t.title}
              {terminals.length > 1 && <span className="faint">{i + 1}</span>}
            </button>
          ))}
        </div>
        <div className="term-actions">
          {tab === "terminal" && (
            <>
              <button className="icon-btn" title="New Terminal (⌃⇧`)" onClick={() => createTerminal()}>
                <Plus size={15} strokeWidth={1.8} />
              </button>
              <button className="icon-btn" title="Kill Terminal" onClick={() => active != null && closeTerminal(active)}>
                <Trash2 size={14} strokeWidth={1.7} />
              </button>
            </>
          )}
          <button
            className="icon-btn"
            title="Hide Panel (⌃`)"
            onClick={() => {
              set({ terminalOpen: false });
              session.focus();
            }}
          >
            <ChevronDown size={16} strokeWidth={1.8} />
          </button>
        </div>
      </div>
      <div className="term-body" ref={host} style={{ display: tab === "terminal" ? undefined : "none" }} />
      {tab === "problems" && <ProblemsList />}
    </section>
  );
}
