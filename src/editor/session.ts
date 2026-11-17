import {
  Annotation,
  Compartment,
  EditorSelection,
  EditorState,
  StateEffect,
  Text,
  type ChangeSpec,
  type Extension,
  type TransactionSpec,
} from "@codemirror/state";
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
  scrollPastEnd,
  type ViewUpdate,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  insertBlankLine,
  selectLine,
  selectParentSyntax,
  toggleBlockComment,
  toggleComment,
  moveLineUp,
  moveLineDown,
} from "@codemirror/commands";
import { nextDiagnostic, previousDiagnostic } from "@codemirror/lint";
import { openSearchPanel } from "@codemirror/search";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, indentUnit } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { EditorSelection as Sel, Prec, type StateCommand } from "@codemirror/state";
import type { Command as ViewCommand } from "@codemirror/view";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { diff } from "@codemirror/merge";
import { editorHighlight, editorTheme } from "./theme";
import { completionExtensions, setOtherDocsProvider } from "./completion";
import { gitDecorations, setGitBase } from "./decorations";
import { indentGuides, overviewRuler } from "./decorations";
import { lsp, type TextEdit } from "../lsp/client";
import { describe } from "../lib/languages";
import { settings } from "../lib/settings";
import { get, set, useStore, type Problem } from "../store";

type Eol = "\n" | "\r\n";
// `indent` is set when the user picks an indentation from the status bar, overriding detection.
type Doc = { state: EditorState; saved: Text; eol: Eol; savedEol: Eol; indent?: Indent; scroll?: StateEffect<unknown> };

// CodeMirror stores lines without separators, so remember each file's line ending
// and write it back on save instead of silently converting CRLF files to LF.
const detectEol = (content: string): Eol => {
  const i = content.indexOf("\n");
  return i > 0 && content[i - 1] === "\r" ? "\r\n" : "\n";
};
const toLf = (content: string) => content.replace(/\r\n/g, "\n");
type Indent = { unit: string; size: number; label: string };

const docs = new Map<string, Doc>();
const bases = new Map<string, Text | null>();
const scroll2 = new Map<string, StateEffect<unknown>>();
const changeListeners = new Set<(path: string) => void>();
const language = new Compartment();
const wrapping = new Compartment();
const indentation = new Compartment();
const lspSlot = new Compartment();
const mirrorLanguage = new Compartment();
const sync = Annotation.define<boolean>();

let view: EditorView | null = null;
let view2: EditorView | null = null;
let inView: string | null = null;
let inView2: string | null = null;
let focused: 0 | 1 = 0;
let focusHandler: (pane: 0 | 1) => void = () => {};

function chevron(open: boolean) {
  const el = document.createElement("span");
  el.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="transform: rotate(${open ? 0 : -90}deg)"><path d="m6 9 6 6 6-6"/></svg>`;
  el.style.display = "inline-flex";
  return el;
}

function makeIndent(useTabs: boolean, size: number): Indent {
  return useTabs ? { unit: "\t", size, label: `Tab Size: ${size}` } : { unit: " ".repeat(size), size, label: `Spaces: ${size}` };
}

function configuredIndent(): Indent {
  const size = Math.max(1, Math.min(16, settings["editor.tabSize"] ?? 2));
  return makeIndent(settings["editor.insertSpaces"] === false, size);
}

const indentExtension = (indent: { unit: string; size: number }) => [indentUnit.of(indent.unit), EditorState.tabSize.of(indent.size)];

function detectIndent(doc: Text): Indent {
  if (settings["editor.detectIndentation"] === false) return configuredIndent();
  let tabs = 0;
  let twos = 0;
  let fours = 0;
  const limit = Math.min(doc.lines, 800);
  for (let i = 1; i <= limit; i++) {
    const text = doc.line(i).text;
    if (text.startsWith("\t")) tabs++;
    else {
      const m = /^ +/.exec(text);
      if (!m) continue;
      const n = m[0].length;
      if (n % 4 === 0) fours++;
      else if (n % 2 === 0) twos++;
    }
  }
  if (tabs + twos + fours === 0) return configuredIndent();
  if (tabs > twos + fours) return makeIndent(true, settings["editor.tabSize"] ?? 4);
  if (twos > 0 || fours === 0) return makeIndent(false, 2);
  return makeIndent(false, 4);
}

function indentFor(path: string, doc: Text): Indent {
  return docs.get(path)?.indent ?? detectIndent(doc);
}

// Publishes the focused file's indentation and line ending for the status bar.
function publishMeta() {
  const path = focused === 1 && view2 && inView2 ? inView2 : inView;
  const d = path ? docs.get(path) : undefined;
  const state = path ? currentState(path) : null;
  if (!path || !d || !state) return;
  set({ indent: indentFor(path, state.doc).label, eol: d.eol === "\r\n" ? "CRLF" : "LF" });
}

function emitChange(path: string) {
  for (const fn of changeListeners) fn(path);
}

function refreshDirty(path: string) {
  const d = docs.get(path);
  if (!d) return;
  const current = path === inView && view ? view.state.doc : d.state.doc;
  const dirty = !current.eq(d.saved) || d.eol !== d.savedEol;
  const tab = get().tabs.find((t) => t.path === path);
  if (tab && tab.dirty !== dirty) set((s) => ({ tabs: s.tabs.map((t) => (t.path === path ? { ...t, dirty } : t)) }));
}

function forwardable(u: ViewUpdate) {
  return u.transactions.filter((tr) => tr.docChanged && !tr.annotation(sync));
}

const listener = EditorView.updateListener.of((u) => {
  if (!inView) return;
  if (u.docChanged) {
    const path = inView;
    if (view2 && inView2 === path) {
      for (const tr of forwardable(u)) view2.dispatch({ changes: tr.changes, annotations: sync.of(true) });
    }
    refreshDirty(path);
    lsp.changed(path);
    emitChange(path);
  }
  if ((u.docChanged || u.selectionSet || u.focusChanged) && focused === 0) publishCursor(u.state);
});

const mirrorListener = EditorView.updateListener.of((u) => {
  const path = inView2;
  if (!path) return;
  if (u.docChanged) {
    const txs = forwardable(u);
    if (txs.length) {
      if (path === inView && view) {
        for (const tr of txs) view.dispatch({ changes: tr.changes, annotations: sync.of(true) });
      } else {
        const d = docs.get(path);
        if (d) {
          for (const tr of txs) d.state = d.state.update({ changes: tr.changes, annotations: sync.of(true) }).state;
          refreshDirty(path);
          lsp.changed(path);
          emitChange(path);
        }
      }
    }
  }
  if ((u.docChanged || u.selectionSet || u.focusChanged) && focused === 1) publishCursor(u.state);
});

function publishCursor(state: EditorState) {
  const sel = state.selection.main;
  const line = state.doc.lineAt(sel.head);
  const selected = state.selection.ranges.reduce((n, r) => n + (r.to - r.from), 0);
  set({ cursor: { line: line.number, col: sel.head - line.from + 1, selected, lines: state.doc.lines } });
}

function focusTracker(pane: 0 | 1) {
  return EditorView.domEventHandlers({
    focus: () => {
      if (focused !== pane) {
        focused = pane;
        focusHandler(pane);
      }
      return false;
    },
  });
}

const insertLineAbove: ViewCommand = (view) => {
  const { state } = view;
  const changes = state.changeByRange((range) => {
    const line = state.doc.lineAt(range.head);
    const indent = /^\s*/.exec(line.text)![0];
    return { changes: { from: line.from, insert: indent + state.lineBreak }, range: Sel.cursor(line.from + indent.length) };
  });
  view.dispatch(state.update(changes, { scrollIntoView: true, userEvent: "input" }));
  return true;
};

const cursorsAtLineEnds: ViewCommand = (view) => {
  const { state } = view;
  const ranges = [];
  for (const r of state.selection.ranges) {
    if (r.empty) continue;
    const first = state.doc.lineAt(r.from).number;
    const last = state.doc.lineAt(r.to).number;
    for (let n = first; n <= last; n++) {
      const line = state.doc.line(n);
      if (n === last && r.to === line.from && n > first) continue;
      ranges.push(Sel.cursor(n === last ? Math.min(line.to, r.to) : line.to));
    }
  }
  if (!ranges.length) return false;
  view.dispatch({ selection: Sel.create(ranges), userEvent: "select" });
  return true;
};

const expandHistory = new WeakMap<EditorView, EditorSelection[]>();

const expandSelection: ViewCommand = (view) => {
  const before = view.state.selection;
  const stack = expandHistory.get(view) ?? [];
  if (!selectParentSyntax(view as unknown as Parameters<StateCommand>[0])) return false;
  if (!view.state.selection.eq(before)) expandHistory.set(view, [...stack, before]);
  return true;
};

const shrinkSelection: ViewCommand = (view) => {
  const stack = expandHistory.get(view);
  if (!stack?.length) return false;
  const prev = stack.pop()!;
  view.dispatch({ selection: prev, userEvent: "select" });
  return true;
};

const openReplace: ViewCommand = (view) => {
  openSearchPanel(view);
  requestAnimationFrame(() => view.dom.querySelector<HTMLInputElement>(".cm-search input[name=replace]")?.focus());
  return true;
};

export const editorCommands = { expandSelection, shrinkSelection, openReplace, cursorsAtLineEnds };

const vscodeKeymap = Prec.high(
  keymap.of([
    { key: "Mod-l", run: selectLine, preventDefault: true },
    { key: "Shift-Alt-a", run: toggleBlockComment },
    { key: "Mod-Enter", run: insertBlankLine },
    { key: "Shift-Mod-Enter", run: insertLineAbove },
    { key: "Shift-Alt-i", run: cursorsAtLineEnds },
    { key: "Ctrl-Shift-Mod-ArrowRight", run: expandSelection },
    { key: "Ctrl-Shift-Mod-ArrowLeft", run: shrinkSelection },
    { key: "Mod-Alt-f", run: openReplace, preventDefault: true },
    { key: "F8", run: nextDiagnostic, preventDefault: true },
    { key: "Shift-F8", run: previousDiagnostic, preventDefault: true },
  ]),
);

const vscodeMouse = [
  EditorView.clickAddsSelectionRange.of((e) => e.altKey && !e.shiftKey),
  EditorView.updateListener.of((u) => {
    if (u.docChanged || (u.selectionSet && !u.transactions.some((t) => t.isUserEvent("select")))) {
      const stack = expandHistory.get(u.view);
      if (stack?.length && u.docChanged) expandHistory.delete(u.view);
    }
  }),
];

function sharedExtensions(indent: { unit: string; size: number }): Extension[] {
  return [
    lineNumbers(),
    gitDecorations,
    foldGutter({ markerDOM: chevron }),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    completionExtensions(),
    rectangularSelection({ eventFilter: (e) => e.altKey && e.shiftKey }),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    search({ top: true }),
    scrollPastEnd(),
    indentation.of(indentExtension(indent)),
    vscodeKeymap,
    vscodeMouse,
    keymap.of([
      ...closeBracketsKeymap,
      { key: "Mod-/", run: toggleComment },
      { key: "Alt-ArrowUp", run: moveLineUp },
      { key: "Alt-ArrowDown", run: moveLineDown },
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      indentWithTab,
    ]),
    editorTheme,
    editorHighlight,
    overviewRuler,
    indentGuides,
    wrapping.of(get().wrap ? EditorView.lineWrapping : []),
  ];
}

function baseExtensions(indent: Indent): Extension[] {
  return [...sharedExtensions(indent), language.of([]), lspSlot.of([]), focusTracker(0), listener];
}

function mirrorExtensions(indent: Indent): Extension[] {
  return [...sharedExtensions(indent), mirrorLanguage.of([]), focusTracker(1), mirrorListener];
}

function currentState(path: string): EditorState | null {
  if (path === inView && view) return view.state;
  return docs.get(path)?.state ?? null;
}

function applyEffects(path: string, effects: StateEffect<unknown>[]) {
  const d = docs.get(path);
  if (!d) return;
  if (path === inView && view) view.dispatch({ effects });
  else d.state = d.state.update({ effects }).state;
}

function applySpec(path: string, make: (state: EditorState) => TransactionSpec) {
  const d = docs.get(path);
  if (!d) return;
  if (path === inView && view) {
    view.dispatch(make(view.state));
  } else {
    const tr = d.state.update(make(d.state));
    d.state = tr.state;
    if (tr.docChanged) {
      if (view2 && inView2 === path) view2.dispatch({ changes: tr.changes, annotations: sync.of(true) });
      refreshDirty(path);
      lsp.changed(path);
      emitChange(path);
    }
  }
  if (view2 && inView2 === path) {
    const spec = make(view2.state);
    if (spec.effects) view2.dispatch({ effects: spec.effects });
  }
}

function attachLanguageServer(path: string) {
  lsp
    .attach(path, get().root)
    .then((ext) => {
      if (ext && docs.has(path)) applyEffects(path, [lspSlot.reconfigure(ext)]);
    })
    .catch(() => {});
}

function toDiagnostics(doc: Text, problems: Problem[]): Diagnostic[] {
  const offset = (line: number, col: number) => {
    if (line + 1 > doc.lines) return doc.length;
    const l = doc.line(line + 1);
    return Math.min(l.from + col, l.to);
  };
  const severity = { 1: "error", 2: "warning", 3: "info", 4: "hint" } as const;
  return problems.map((p) => {
    const from = offset(p.line, p.col);
    return {
      from,
      to: Math.max(from, offset(p.endLine, p.endCol)),
      severity: severity[p.severity] ?? "error",
      message: p.message,
      source: p.source ? `${p.source}${p.code ? `(${p.code})` : ""}` : undefined,
    };
  });
}

function applyProblems(path: string, problems: Problem[]) {
  if (!docs.has(path)) return;
  applySpec(path, (state) => setDiagnostics(state, toDiagnostics(state.doc, problems)));
}

useStore.subscribe((s, prev) => {
  if (s.problems === prev.problems) return;
  const paths = new Set([...Object.keys(s.problems), ...Object.keys(prev.problems)]);
  for (const path of paths) {
    if (s.problems[path] !== prev.problems[path]) applyProblems(path, s.problems[path] ?? []);
  }
});

setOtherDocsProvider(() => [...docs].map(([p, d]) => (p === inView && view ? view.state.doc : d.state.doc)));

function stash() {
  if (!view || !inView) return;
  const d = docs.get(inView);
  if (d) {
    d.state = view.state;
    d.scroll = view.scrollSnapshot();
  }
}

function loadLanguage(path: string, apply: (support: Extension) => void) {
  const desc = describe(path);
  if (desc)
    desc
      .load()
      .then(apply)
      .catch(() => {});
  else apply([]);
}

export const session = {
  mount(parent: HTMLElement) {
    if (view) {
      parent.appendChild(view.dom);
      return;
    }
    view = new EditorView({ parent, state: EditorState.create({ doc: "" }) });
  },

  mountSecondary(parent: HTMLElement) {
    if (view2) {
      parent.appendChild(view2.dom);
      return;
    }
    view2 = new EditorView({ parent, state: EditorState.create({ doc: "" }) });
  },

  unmountSecondary() {
    if (view2 && inView2) {
      scroll2.set(inView2, view2.scrollSnapshot());
    }
    view2?.destroy();
    view2 = null;
    inView2 = null;
    if (focused === 1) {
      focused = 0;
      if (inView) view?.focus();
    }
  },

  setFocusHandler(fn: (pane: 0 | 1) => void) {
    focusHandler = fn;
  },

  setFocused(pane: 0 | 1) {
    focused = pane;
    const v = pane === 1 ? view2 : view;
    if (v) publishCursor(v.state);
    publishMeta();
  },

  onChange(fn: (path: string) => void) {
    changeListeners.add(fn);
    return () => changeListeners.delete(fn);
  },

  has: (path: string) => docs.has(path),

  open(path: string, content: string) {
    const doc = Text.of(content.split(/\r?\n/));
    const indent = detectIndent(doc);
    const state = EditorState.create({ doc, extensions: baseExtensions(indent) });
    const eol = detectEol(content);
    docs.set(path, { state, saved: state.doc, eol, savedEol: eol });
    loadLanguage(path, (support) => applyEffects(path, [language.reconfigure(support)]));
    const base = bases.get(path);
    if (base !== undefined) applyEffects(path, [setGitBase.of(base)]);
    const problems = get().problems[path];
    if (problems) applyProblems(path, problems);
    attachLanguageServer(path);
  },

  show(path: string | null) {
    if (path && path === inView && view) {
      if (focused === 0) view.focus();
      return;
    }
    stash();
    inView = null;
    if (!view || !path) return;
    const d = docs.get(path);
    if (!d) return;
    view.setState(d.state);
    inView = path;
    if (d.scroll) view.dispatch({ effects: d.scroll });
    if (focused === 0) {
      publishCursor(d.state);
      publishMeta();
    }
    requestAnimationFrame(() => {
      view?.requestMeasure();
      if (focused === 0) view?.focus();
    });
  },

  showSecondary(path: string | null) {
    if (!view2) return;
    if (path && path === inView2) {
      if (focused === 1) view2.focus();
      return;
    }
    if (inView2) scroll2.set(inView2, view2.scrollSnapshot());
    inView2 = null;
    if (!path) {
      view2.setState(EditorState.create({ doc: "" }));
      return;
    }
    const source = currentState(path);
    if (!source) return;
    const indent = indentFor(path, source.doc);
    const base = bases.get(path);
    view2.setState(
      EditorState.create({
        doc: source.doc,
        selection: source.selection,
        extensions: mirrorExtensions(indent),
      }),
    );
    inView2 = path;
    if (base !== undefined) view2.dispatch({ effects: setGitBase.of(base) });
    const problems = get().problems[path];
    if (problems) view2.dispatch(setDiagnostics(view2.state, toDiagnostics(view2.state.doc, problems)));
    loadLanguage(path, (support) => {
      if (view2 && inView2 === path) view2.dispatch({ effects: mirrorLanguage.reconfigure(support) });
    });
    const snap = scroll2.get(path);
    view2.dispatch({ effects: snap ?? EditorView.scrollIntoView(view2.state.selection.main.head, { y: "center" }) });
    if (focused === 1) {
      publishCursor(view2.state);
      publishMeta();
    }
    requestAnimationFrame(() => {
      view2?.requestMeasure();
      if (focused === 1) view2?.focus();
    });
  },

  close(path: string) {
    lsp.release(path);
    docs.delete(path);
    bases.delete(path);
    if (inView === path) inView = null;
    if (inView2 === path && view2) {
      inView2 = null;
      view2.setState(EditorState.create({ doc: "" }));
    }
  },

  content(path: string): string | null {
    const doc = currentState(path)?.doc;
    if (!doc) return null;
    return doc.sliceString(0, doc.length, docs.get(path)?.eol ?? "\n");
  },

  markSaved(path: string) {
    const d = docs.get(path);
    if (!d) return;
    d.saved = currentState(path)!.doc;
    d.savedEol = d.eol;
    refreshDirty(path);
    lsp.saved(path);
  },

  isDirty(path: string) {
    const d = docs.get(path);
    if (!d) return false;
    return !currentState(path)!.doc.eq(d.saved) || d.eol !== d.savedEol;
  },

  // Changes the line ending written on the next save; the file becomes dirty.
  setEol(path: string, eol: "LF" | "CRLF") {
    const d = docs.get(path);
    if (!d) return;
    d.eol = eol === "CRLF" ? "\r\n" : "\n";
    refreshDirty(path);
    publishMeta();
  },

  // Sets the indentation used for new lines and Tab in this file.
  setIndentation(path: string, useTabs: boolean, size: number) {
    const d = docs.get(path);
    if (!d) return;
    d.indent = makeIndent(useTabs, size);
    const effects = [indentation.reconfigure(indentExtension(d.indent))];
    applyEffects(path, effects);
    if (view2 && inView2 === path) view2.dispatch({ effects });
    publishMeta();
  },

  // Rewrites leading whitespace on every line to the file's current indentation style.
  convertIndentation(path: string, toTabs: boolean) {
    const state = currentState(path);
    if (!state) return;
    const indent = indentFor(path, state.doc);
    const size = indent.size;
    const changes: ChangeSpec[] = [];
    for (let n = 1; n <= state.doc.lines; n++) {
      const line = state.doc.line(n);
      const lead = /^[ \t]*/.exec(line.text)![0];
      if (!lead) continue;
      let width = 0;
      for (const ch of lead) width = ch === "\t" ? width + size - (width % size) : width + 1;
      const next = toTabs ? "\t".repeat(Math.floor(width / size)) + " ".repeat(width % size) : " ".repeat(width);
      if (next !== lead) changes.push({ from: line.from, to: line.from + lead.length, insert: next });
    }
    if (changes.length) applySpec(path, () => ({ changes, userEvent: "input.indent" }));
    this.setIndentation(path, toTabs, size);
  },

  replace(path: string, raw: string) {
    const d = docs.get(path);
    const current = currentState(path);
    if (!d || !current) return;
    d.eol = d.savedEol = detectEol(raw);
    const content = toLf(raw);
    if (current.doc.toString() === content) return;
    applySpec(path, (state) => ({
      changes: { from: 0, to: state.doc.length, insert: content },
      selection: EditorSelection.cursor(Math.min(state.selection.main.head, content.length)),
    }));
    d.saved = currentState(path)!.doc;
    refreshDirty(path);
  },

  applyFormatted(path: string, formatted: string, userEvent = "format") {
    const current = currentState(path);
    if (!current) return false;
    const next = toLf(formatted);
    const text = current.doc.toString();
    if (text === next) return false;
    const changes: ChangeSpec[] = diff(text, next).map((c) => ({ from: c.fromA, to: c.toA, insert: next.slice(c.fromB, c.toB) }));
    applySpec(path, () => ({ changes, userEvent }));
    return true;
  },

  applyEdits(path: string, edits: TextEdit[]) {
    const current = currentState(path);
    if (!current || !edits.length) return false;
    const doc = current.doc;
    const offset = (p: { line: number; character: number }) => {
      if (p.line + 1 > doc.lines) return doc.length;
      const l = doc.line(p.line + 1);
      return Math.min(l.from + p.character, l.to);
    };
    const changes = edits
      .map((e) => ({ from: offset(e.range.start), to: offset(e.range.end), insert: e.newText }))
      .sort((a, b) => a.from - b.from || a.to - b.to);
    applySpec(path, () => ({ changes, userEvent: "format" }));
    return true;
  },

  indentOf(path: string) {
    const state = currentState(path);
    return state ? indentFor(path, state.doc) : configuredIndent();
  },

  setBase(path: string, base: string | null, fromSaved = false) {
    const saved = docs.get(path)?.saved;
    const text = fromSaved ? saved ?? null : base == null ? null : Text.of(base.split(/\r?\n/));
    const prev = bases.get(path);
    if (prev === text || (prev && text && prev.eq(text))) return;
    bases.set(path, text);
    if (!docs.has(path)) return;
    applyEffects(path, [setGitBase.of(text)]);
    if (view2 && inView2 === path) view2.dispatch({ effects: setGitBase.of(text) });
  },

  rename(from: string, to: string) {
    const d = docs.get(from);
    if (!d) return;
    applyEffects(from, [lspSlot.reconfigure([])]);
    lsp.release(from);
    docs.delete(from);
    docs.set(to, d);
    bases.delete(from);
    if (inView === from) inView = to;
    if (inView2 === from) inView2 = to;
    loadLanguage(to, (support) => applyEffects(to, [language.reconfigure(support)]));
    attachLanguageServer(to);
  },

  reattachLanguageServers() {
    for (const path of docs.keys()) {
      applyEffects(path, [lspSlot.reconfigure([])]);
      attachLanguageServer(path);
    }
  },

  setWrap(on: boolean) {
    const effect = wrapping.reconfigure(on ? EditorView.lineWrapping : []);
    for (const path of docs.keys()) applyEffects(path, [effect]);
    view2?.dispatch({ effects: effect });
  },

  remeasure() {
    view?.requestMeasure();
    view2?.requestMeasure();
  },

  focus() {
    const v = focused === 1 && view2 && inView2 ? view2 : view;
    v?.focus();
  },

  reveal(line: number, col: number, len: number) {
    const v = this.view;
    if (!v) return;
    const n = Math.max(1, Math.min(line, v.state.doc.lines));
    const l = v.state.doc.line(n);
    const from = Math.min(l.from + col, l.to);
    const to = Math.min(from + len, l.to);
    v.dispatch({ selection: { anchor: from, head: to }, effects: EditorView.scrollIntoView(from, { y: "center" }) });
    v.focus();
  },

  gotoLine(line: number) {
    const v = this.view;
    if (!v) return;
    const n = Math.max(1, Math.min(line, v.state.doc.lines));
    const pos = v.state.doc.line(n).from;
    v.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "center" }) });
    v.focus();
  },

  peek(line: number, col: number) {
    const v = this.view;
    if (!v) return;
    const n = Math.max(1, Math.min(line, v.state.doc.lines));
    const l = v.state.doc.line(n);
    const pos = Math.min(l.from + col, l.to);
    v.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "center" }) });
  },

  get view() {
    if (focused === 1 && view2 && inView2) return view2;
    return view;
  },

  get primary() {
    return view;
  },

  get secondary() {
    return view2;
  },
};

if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
