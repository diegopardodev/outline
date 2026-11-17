import { RangeSet, RangeSetBuilder, StateEffect, StateField, type EditorState, type Text } from "@codemirror/state";
import { Decoration, EditorView, GutterMarker, ViewPlugin, gutter, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { indentUnit } from "@codemirror/language";
import { Chunk } from "@codemirror/merge";
import { forEachDiagnostic } from "@codemirror/lint";
import { getSearchQuery, searchPanelOpen } from "@codemirror/search";

const MAX_DIFF_LINES = 30000;

export const setGitBase = StateEffect.define<Text | null>();

type GitState = { base: Text | null; chunks: readonly Chunk[] };

export const gitField = StateField.define<GitState>({
  create: () => ({ base: null, chunks: [] }),
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setGitBase)) {
        const base = e.value;
        if (!base || base.lines > MAX_DIFF_LINES || tr.state.doc.lines > MAX_DIFF_LINES) return { base, chunks: [] };
        return { base, chunks: Chunk.build(base, tr.state.doc) };
      }
    }
    if (!tr.docChanged || !value.base) return value;
    if (tr.state.doc.lines > MAX_DIFF_LINES) return { base: value.base, chunks: [] };
    return { base: value.base, chunks: Chunk.updateB(value.chunks, value.base, tr.state.doc, tr.changes) };
  },
});

class GitMarker extends GutterMarker {
  constructor(readonly kind: "added" | "modified" | "deleted") {
    super();
  }
  eq(other: GitMarker) {
    return other.kind === this.kind;
  }
  toDOM() {
    const el = document.createElement("div");
    el.className = `cm-git-${this.kind}`;
    return el;
  }
}

const markers = {
  added: new GitMarker("added"),
  modified: new GitMarker("modified"),
  deleted: new GitMarker("deleted"),
};

export function chunkKind(c: Chunk): "added" | "modified" | "deleted" {
  if (c.fromB === c.toB) return "deleted";
  if (c.fromA === c.toA) return "added";
  return "modified";
}

const gitMarkers = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(value, tr) {
    const prev = tr.startState.field(gitField, false);
    const next = tr.state.field(gitField, false);
    if (prev === next && !tr.docChanged) return value;
    if (!next || !next.chunks.length) return RangeSet.empty;
    const doc = tr.state.doc;
    const builder = new RangeSetBuilder<GutterMarker>();
    let last = -1;
    for (const c of next.chunks) {
      const kind = chunkKind(c);
      const start = doc.lineAt(Math.min(c.fromB, doc.length));
      if (kind === "deleted") {
        if (start.from > last) builder.add(start.from, start.from, markers.deleted);
        last = start.from;
        continue;
      }
      const end = doc.lineAt(Math.min(c.endB, doc.length)).number;
      for (let n = start.number; n <= end; n++) {
        const from = doc.line(n).from;
        if (from <= last) continue;
        builder.add(from, from, markers[kind]);
        last = from;
      }
    }
    return builder.finish();
  },
});

const gitGutter = gutter({
  class: "cm-git-gutter",
  markers: (view) => view.state.field(gitMarkers, false) ?? RangeSet.empty,
});

const gitTheme = EditorView.baseTheme({
  ".cm-git-gutter": { width: "4px", marginLeft: "2px" },
  ".cm-git-gutter .cm-gutterElement": { padding: "0", position: "relative" },
  ".cm-git-added, .cm-git-modified": { position: "absolute", left: "0", top: "1px", bottom: "1px", width: "3px", borderRadius: "1.5px" },
  ".cm-git-added": { background: "var(--git-added)" },
  ".cm-git-modified": { background: "var(--git-modified)" },
  ".cm-git-deleted": {
    position: "absolute",
    left: "-1px",
    top: "-4px",
    width: "0",
    height: "0",
    borderTop: "4px solid transparent",
    borderBottom: "4px solid transparent",
    borderLeft: "5px solid var(--git-deleted)",
  },
});

export const gitDecorations = [gitField, gitMarkers, gitGutter, gitTheme];

type Mark = { pos: number; end?: number; color: string; lane: 0 | 1 | 2 };

function cssVar(el: HTMLElement, name: string, fallback: string) {
  return getComputedStyle(el).getPropertyValue(name).trim() || fallback;
}

function collectMarks(state: EditorState, el: HTMLElement): Mark[] {
  const marks: Mark[] = [];
  const colors = {
    error: cssVar(el, "--ruler-error", "#e5484d"),
    warning: cssVar(el, "--ruler-warning", "#d68c00"),
    info: cssVar(el, "--ruler-info", "#0a84ff"),
    match: cssVar(el, "--ruler-match", "rgba(213, 159, 16, 0.9)"),
    added: cssVar(el, "--git-added", "#30a46c"),
    modified: cssVar(el, "--git-modified", "#0a84ff"),
    deleted: cssVar(el, "--git-deleted", "#e5484d"),
  };
  const git = state.field(gitField, false);
  for (const c of git?.chunks ?? []) {
    const kind = chunkKind(c);
    marks.push({ pos: Math.min(c.fromB, state.doc.length), end: Math.min(c.endB, state.doc.length), color: colors[kind], lane: 0 });
  }
  if (searchPanelOpen(state)) {
    const query = getSearchQuery(state);
    if (query.valid && query.search) {
      const cursor = query.getCursor(state);
      for (let i = 0; i < 2000; i++) {
        const next = cursor.next();
        if (next.done) break;
        marks.push({ pos: next.value.from, color: colors.match, lane: 1 });
      }
    }
  }
  const diags: Mark[] = [];
  forEachDiagnostic(state, (d, from) => {
    const color = d.severity === "error" ? colors.error : d.severity === "warning" ? colors.warning : colors.info;
    diags.push({ pos: from, color, lane: 2 });
  });
  diags.sort((a, b) => (a.color === colors.error ? 1 : 0) - (b.color === colors.error ? 1 : 0));
  return marks.concat(diags);
}

class OverviewRuler {
  canvas: HTMLCanvasElement;
  frame = 0;
  constructor(readonly view: EditorView) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "cm-overview-ruler";
    view.dom.appendChild(this.canvas);
    this.schedule();
  }
  update(u: ViewUpdate) {
    if (u.docChanged || u.geometryChanged || u.selectionSet || u.heightChanged || u.transactions.some((t) => t.effects.length)) this.schedule();
  }
  schedule() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }
  draw() {
    const { view, canvas } = this;
    const scroller = view.scrollDOM;
    const height = scroller.clientHeight;
    const width = 10;
    const ratio = window.devicePixelRatio || 1;
    if (canvas.width !== width * ratio || canvas.height !== Math.round(height * ratio)) {
      canvas.width = width * ratio;
      canvas.height = Math.round(height * ratio);
      canvas.style.height = `${height}px`;
    }
    canvas.style.top = `${scroller.offsetTop}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const total = Math.max(scroller.scrollHeight, 1);
    if (total <= height + 2 && view.state.doc.lines < 40) return;
    const pad = view.documentPadding.top;
    const y = (pos: number) => ((view.lineBlockAt(pos).top + pad) / total) * height;
    const lanes: Record<number, [number, number]> = { 0: [0, 3], 1: [3, 4], 2: [5, 5] };
    for (const m of collectMarks(view.state, view.dom)) {
      const top = y(m.pos);
      const bottom = m.end != null ? Math.max(y(m.end) + ((view.lineBlockAt(m.end).height) / total) * height, top + 2) : top + 2;
      const [x, w] = lanes[m.lane];
      ctx.fillStyle = m.color;
      ctx.fillRect(x, Math.min(top, height - 2), w, Math.max(2, bottom - top));
    }
    const head = view.state.selection.main.head;
    ctx.fillStyle = cssVar(view.dom, "--ruler-cursor", "rgba(60, 60, 67, 0.55)");
    ctx.fillRect(0, Math.min(y(head), height - 2), width, 1.5);
  }
  destroy() {
    cancelAnimationFrame(this.frame);
    this.canvas.remove();
  }
}

export const overviewRuler = [
  ViewPlugin.fromClass(OverviewRuler),
  EditorView.baseTheme({
    ".cm-overview-ruler": { position: "absolute", right: "2px", width: "10px", pointerEvents: "none", zIndex: "5", opacity: "0.9" },
  }),
];

function indentWidth(text: string, tabSize: number) {
  let col = 0;
  for (const ch of text) {
    if (ch === " ") col++;
    else if (ch === "\t") col += tabSize - (col % tabSize);
    else return { col, blank: false };
  }
  return { col, blank: true };
}

function guideUnit(state: EditorState) {
  const unit = state.facet(indentUnit);
  return unit === "\t" ? state.tabSize : Math.max(1, unit.length);
}

function lineLevels(state: EditorState) {
  const doc = state.doc;
  const unit = guideUnit(state);
  const cache = new Map<number, number | null>();
  const raw = (n: number): number | null => {
    let v = cache.get(n);
    if (v === undefined) {
      const { col, blank } = indentWidth(doc.line(n).text, state.tabSize);
      v = blank ? null : Math.floor(col / unit);
      cache.set(n, v);
    }
    return v;
  };
  const level = (n: number): number => {
    const own = raw(n);
    if (own !== null) return own;
    let above = 0;
    for (let i = n - 1; i >= Math.max(1, n - 200); i--) {
      const v = raw(i);
      if (v !== null) {
        above = v;
        break;
      }
    }
    let below = 0;
    for (let i = n + 1; i <= Math.min(doc.lines, n + 200); i++) {
      const v = raw(i);
      if (v !== null) {
        below = v;
        break;
      }
    }
    return Math.max(above, below);
  };
  return { level, raw, unit };
}

function activeGuide(state: EditorState, levels: ReturnType<typeof lineLevels>) {
  const doc = state.doc;
  const c = doc.lineAt(state.selection.main.head).number;
  const lc = levels.level(c);
  let next = 0;
  for (let i = c + 1; i <= Math.min(doc.lines, c + 200); i++) {
    const v = levels.raw(i);
    if (v !== null) {
      next = v;
      break;
    }
  }
  const opener = levels.raw(c) !== null && next > lc;
  const target = opener ? lc + 1 : lc;
  if (target < 1) return null;
  let from = opener ? c + 1 : c;
  let to = from;
  if (!opener) {
    while (from > 1 && c - from < 3000 && levels.level(from - 1) >= target) from--;
  }
  while (to < doc.lines && to - c < 3000 && levels.level(to + 1) >= target) to++;
  return { index: target - 1, from, to };
}

const guideCache = new Map<string, Decoration>();

function guideDecoration(count: number, unit: number, active: number) {
  const key = `${count}:${unit}:${active}`;
  let deco = guideCache.get(key);
  if (!deco) {
    const images: string[] = [];
    const positions: string[] = [];
    for (let k = 0; k < count; k++) {
      const color = k === active ? "var(--indent-guide-active)" : "var(--indent-guide)";
      images.push(`linear-gradient(${color}, ${color})`);
      positions.push(`calc(var(--guide-offset) + ${k * unit}ch) 0`);
    }
    deco = Decoration.line({
      attributes: {
        style: `background-image: ${images.join(", ")}; background-position: ${positions.join(", ")}; background-size: 1px 100%; background-repeat: no-repeat;`,
      },
    });
    guideCache.set(key, deco);
  }
  return deco;
}

function buildGuides(view: EditorView): DecorationSet {
  const { state } = view;
  const levels = lineLevels(state);
  const active = activeGuide(state, levels);
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = state.doc.lineAt(pos);
      const count = levels.level(line.number);
      if (count > 0) {
        const act = active && line.number >= active.from && line.number <= active.to && count > active.index ? active.index : -1;
        builder.add(line.from, line.from, guideDecoration(count, levels.unit, act));
      }
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

export const indentGuides = [
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildGuides(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged || u.selectionSet || u.startState.facet(indentUnit) !== u.state.facet(indentUnit)) {
          this.decorations = buildGuides(u.view);
        }
      }
    },
    { decorations: (v) => v.decorations },
  ),
  EditorView.baseTheme({
    ".cm-content": { "--guide-offset": "6px" },
  }),
];
