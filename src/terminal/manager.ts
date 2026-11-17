import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { invoke } from "@tauri-apps/api/core";
import "@xterm/xterm/css/xterm.css";
import { pty } from "../lib/fs";
import { fontStack } from "../lib/fonts";
import { settings } from "../lib/settings";
import { session } from "../editor/session";
import { get, set } from "../store";

// `pending` is text to type into the shell once it has been spawned.
type Instance = { term: Terminal; fit: FitAddon; el: HTMLDivElement; started: boolean; running: boolean; pending: string };

const terminalFontSize = () => {
  const size = settings["terminal.fontSize"];
  return typeof size === "number" ? Math.max(8, Math.min(32, size)) : 12.5;
};

const instances = new Map<number, Instance>();
let nextId = 1;

const darkTheme: ITheme = {
  background: "#00000000",
  foreground: "#e6e6e6",
  cursor: "#3ba7ff",
  cursorAccent: "#1e1e1e",
  selectionBackground: "rgba(59, 167, 255, 0.3)",
  black: "#3a3a3c",
  red: "#ff6b6b",
  green: "#5fd38d",
  yellow: "#f5c451",
  blue: "#5aa9ff",
  magenta: "#e07ee0",
  cyan: "#5fd0e8",
  white: "#d0d0d0",
  brightBlack: "#8a8a8e",
  brightRed: "#ff8787",
  brightGreen: "#7fe0a4",
  brightYellow: "#ffd866",
  brightBlue: "#7dbcff",
  brightMagenta: "#f0a0f0",
  brightCyan: "#82e0f0",
  brightWhite: "#ffffff",
};

const theme: ITheme = {
  background: "#00000000",
  foreground: "#0a0a0a",
  cursor: "#009fff",
  cursorAccent: "#ffffff",
  selectionBackground: "rgba(0, 159, 255, 0.2)",
  black: "#1d1d1d",
  red: "#d52c36",
  green: "#18a46c",
  yellow: "#b38d00",
  blue: "#1a85d4",
  magenta: "#bd2e90",
  cyan: "#1795b8",
  white: "#8a8a8a",
  brightBlack: "#737373",
  brightRed: "#d52c36",
  brightGreen: "#77a42a",
  brightYellow: "#d5a910",
  brightBlue: "#1a85d4",
  brightMagenta: "#bd2e90",
  brightCyan: "#1ca1c7",
  brightWhite: "#a3a3a3",
};

export function createTerminal(opts: { title?: string; command?: string } = {}) {
  const id = nextId++;
  const el = document.createElement("div");
  el.className = "term-instance";
  const term = new Terminal({
    fontFamily: fontStack(get().editorFont),
    fontSize: terminalFontSize(),
    lineHeight: 1.3,
    cursorBlink: true,
    cursorStyle: "bar",
    cursorWidth: 2,
    allowTransparency: true,
    allowProposedApi: true,
    macOptionIsMeta: true,
    scrollback: 10000,
    theme: get().dark ? darkTheme : theme,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon((_e, uri) => invoke("open_external", { url: uri }).catch(() => {})));
  term.loadAddon(new Unicode11Addon());
  term.unicode.activeVersion = "11";
  term.onTitleChange((title) => {
    const clean = title.trim().split(/[:\s]/)[0];
    if (clean) set((s) => ({ terminals: s.terminals.map((t) => (t.id === id ? { ...t, title: clean } : t)) }));
  });
  instances.set(id, { term, fit, el, started: false, running: false, pending: opts.command ? opts.command + "\r" : "" });
  set((s) => ({
    terminals: [...s.terminals, { id, title: opts.title ?? "shell", exited: false }],
    activeTerminal: id,
    terminalOpen: true,
    panelTab: "terminal",
  }));
  return id;
}

function start(id: number, inst: Instance) {
  inst.started = true;
  const { term } = inst;
  pty
    .spawn(id, get().root, term.cols, term.rows, (e) => {
      if (e.kind === "Data") term.write(e.data);
      else {
        set((s) => ({ terminals: s.terminals.map((t) => (t.id === id ? { ...t, exited: true } : t)) }));
        term.write("\r\n\x1b[2m[Process completed]\x1b[0m\r\n");
      }
    })
    .then(() => {
      inst.running = true;
      if (inst.pending) {
        pty.write(id, inst.pending).catch(() => {});
        inst.pending = "";
      }
    })
    .catch((err) => term.write(`\r\nCouldn't start shell: ${err}\r\n`));
  term.onData((data) => pty.write(id, data).catch(() => {}));
  term.onResize(({ cols, rows }) => pty.resize(id, cols, rows).catch(() => {}));
}

export function attachTerminal(id: number, host: HTMLElement) {
  const inst = instances.get(id);
  if (!inst) return;
  if (inst.el.parentElement !== host) {
    host.replaceChildren(inst.el);
  }
  if (!inst.term.element) inst.term.open(inst.el);
  fitTerminal(id);
  if (!inst.started) start(id, inst);
  inst.term.focus();
}

export function fitTerminal(id: number | null) {
  if (id == null) return;
  const inst = instances.get(id);
  if (!inst || !inst.el.isConnected) return;
  try {
    inst.fit.fit();
  } catch {}
}

export function focusTerminal() {
  const id = get().activeTerminal;
  if (id != null) instances.get(id)?.term.focus();
}

export function clearTerminal() {
  const id = get().activeTerminal;
  if (id != null) instances.get(id)?.term.clear();
}

export function closeTerminal(id: number) {
  const inst = instances.get(id);
  if (inst) {
    pty.kill(id).catch(() => {});
    inst.term.dispose();
    inst.el.remove();
    instances.delete(id);
  }
  set((s) => {
    const terminals = s.terminals.filter((t) => t.id !== id);
    const activeTerminal = s.activeTerminal === id ? terminals[terminals.length - 1]?.id ?? null : s.activeTerminal;
    return { terminals, activeTerminal, terminalOpen: terminals.length > 0 && s.terminalOpen };
  });
  if (!get().terminalOpen) session.focus();
}

export function toggleTerminal() {
  const { terminalOpen, terminals, panelTab } = get();
  if (terminalOpen && panelTab === "terminal") {
    set({ terminalOpen: false });
    session.focus();
    return;
  }
  if (!terminals.length) createTerminal();
  else set({ terminalOpen: true, panelTab: "terminal" });
}

// Types `text` into a terminal, preferring the active one, and shows it. A terminal
// that hasn't spawned its shell yet receives the text as soon as it starts.
export function sendToTerminal(text: string) {
  const s = get();
  const live = s.terminals.filter((t) => !t.exited);
  const id = live.find((t) => t.id === s.activeTerminal)?.id ?? live[live.length - 1]?.id;
  if (id == null) {
    createTerminal({ command: text.replace(/\r$/, "") });
    return;
  }
  set({ activeTerminal: id, terminalOpen: true, panelTab: "terminal" });
  const inst = instances.get(id);
  if (!inst) return;
  if (inst.running) pty.write(id, text).catch(() => {});
  else inst.pending += text;
  requestAnimationFrame(() => inst.term.focus());
}

export function applyTerminalSettings() {
  const size = terminalFontSize();
  for (const [id, inst] of instances) {
    if (inst.term.options.fontSize === size) continue;
    inst.term.options.fontSize = size;
    fitTerminal(id);
  }
}

export function applyTerminalTheme(dark: boolean) {
  for (const inst of instances.values()) inst.term.options.theme = dark ? darkTheme : theme;
}

export function setTerminalFont(font: string) {
  for (const [id, inst] of instances) {
    inst.term.options.fontFamily = fontStack(font);
    fitTerminal(id);
  }
}

if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
