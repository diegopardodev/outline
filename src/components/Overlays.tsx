import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStore, set, get } from "../store";
import { errorText } from "../lib/fs";
import { session } from "../editor/session";

function closeDialog() {
  set({ dialog: null });
  if (get().active) requestAnimationFrame(() => session.focus());
}

export function DialogHost() {
  const dialog = useStore((s) => s.dialog);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const primary = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setError(null);
    setBusy(false);
    if (dialog?.kind === "input") {
      setValue(dialog.value);
      requestAnimationFrame(() => {
        input.current?.focus();
        input.current?.setSelectionRange(0, dialog.selectUntil ?? dialog.value.length);
      });
    } else if (dialog?.kind === "confirm") {
      requestAnimationFrame(() => primary.current?.focus());
    }
  }, [dialog]);

  if (!dialog) return null;

  const submit = async () => {
    if (dialog.kind !== "input" || busy) return;
    const v = value.trim();
    if (!v) return setError("Name can't be empty.");
    setBusy(true);
    try {
      await dialog.onSubmit(v);
      closeDialog();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <div className="overlay center" onMouseDown={() => (dialog.kind === "confirm" ? null : closeDialog())}>
      <div
        className="dialog glass"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            if (dialog.kind === "confirm") dialog.buttons.find((b) => b.kind === "plain")?.run();
            closeDialog();
          }
        }}
      >
        <div className="dialog-title">{dialog.title}</div>
        {dialog.kind === "input" ? (
          <>
            {dialog.hint && <div className="dialog-hint">in {dialog.hint}/</div>}
            <input
              ref={input}
              className="dialog-input"
              spellCheck={false}
              value={value}
              placeholder={dialog.placeholder}
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
            {error && <div className="dialog-error">{error}</div>}
            <div className="dialog-actions">
              <button className="btn plain" onClick={closeDialog}>
                Cancel
              </button>
              <button className="btn primary" onClick={submit} disabled={busy}>
                {dialog.submitLabel}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="dialog-message">{dialog.message}</div>
            <div className="dialog-actions">
              {dialog.buttons.map((b, i) => (
                <button
                  key={b.label}
                  ref={i === dialog.buttons.length - 1 ? primary : undefined}
                  className={`btn ${b.kind ?? "plain"}`}
                  onClick={async () => {
                    closeDialog();
                    await b.run();
                  }}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function MenuHost() {
  const menu = useStore((s) => s.menu);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({
      x: Math.min(menu.x, window.innerWidth - r.width - 8),
      y: Math.min(menu.y, window.innerHeight - r.height - 8),
    });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && set({ menu: null });
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  if (!menu) return null;
  return (
    <div
      className="overlay clear"
      onMouseDown={() => set({ menu: null })}
      onContextMenu={(e) => {
        e.preventDefault();
        set({ menu: null });
      }}
    >
      <div ref={ref} className="ctx glass" style={{ left: pos.x, top: pos.y }} onMouseDown={(e) => e.stopPropagation()}>
        {menu.items.map((it, i) =>
          it === "separator" ? (
            <div key={i} className="ctx-sep" />
          ) : (
            <button
              key={i}
              className={`ctx-item${it.danger ? " danger" : ""}`}
              onClick={() => {
                set({ menu: null });
                it.run();
              }}
            >
              <span>{it.label}</span>
              {it.shortcut && <span className="ctx-shortcut">{it.shortcut}</span>}
            </button>
          ),
        )}
      </div>
    </div>
  );
}

export function Toast() {
  const toast = useStore((s) => s.toast);
  if (!toast) return null;
  return (
    <div className="toast glass" key={toast.id}>
      {toast.text}
    </div>
  );
}
