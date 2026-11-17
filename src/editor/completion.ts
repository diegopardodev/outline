import {
  acceptCompletion,
  autocompletion,
  completeFromList,
  insertCompletionText,
  pickedCompletion,
  snippet,
  startCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { Prec, type Extension, type Text } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { LSPPlugin } from "@codemirror/lsp-client";

type Position = { line: number; character: number };
type Range = { start: Position; end: Position };
type TextEdit = { range: Range; newText: string };
type MarkupContent = { kind: "markdown" | "plaintext"; value: string };
type Item = {
  label: string;
  labelDetails?: { detail?: string; description?: string };
  kind?: number;
  detail?: string;
  documentation?: string | MarkupContent;
  sortText?: string;
  filterText?: string;
  insertText?: string;
  insertTextFormat?: number;
  textEdit?: { newText: string; range?: Range; insert?: Range; replace?: Range };
  textEditText?: string;
  additionalTextEdits?: TextEdit[];
};
type ItemList = {
  isIncomplete?: boolean;
  items: Item[];
  itemDefaults?: { editRange?: Range | { insert: Range; replace: Range }; insertTextFormat?: number };
};

const kinds = [
  "text",
  "text",
  "method",
  "function",
  "constructor",
  "field",
  "variable",
  "class",
  "interface",
  "module",
  "property",
  "unit",
  "value",
  "enum",
  "keyword",
  "snippet",
  "color",
  "file",
  "reference",
  "folder",
  "enum-member",
  "constant",
  "struct",
  "event",
  "operator",
  "type-parameter",
];

const wordBefore = /[\p{L}\p{N}_$]+$/u;
const wordOnly = /^[\p{L}\p{N}_$]*$/u;

function lspToSnippet(text: string) {
  return text.replace(/\\([$}\\])|\$(\d+)/g, (_m, esc, field) => esc || `\${${field}}`);
}

function toOffset(doc: Text, pos: Position): number | null {
  if (pos.line < 0 || pos.line >= doc.lines) return null;
  const line = doc.line(pos.line + 1);
  if (pos.character < 0 || pos.character > line.length) return null;
  return line.from + pos.character;
}

function validFor(items: Item[]) {
  const prefixes = new Set<string>();
  const step = Math.ceil(items.length / 50);
  for (let i = 0; i < items.length; i += step) {
    const it = items[i];
    const text = it.textEdit?.newText ?? it.textEditText ?? it.insertText ?? it.label;
    const prefix = /^[^\p{L}\p{N}_$]*/u.exec(text)![0];
    if (prefix) prefixes.add(prefix);
  }
  if (!prefixes.size) return wordOnly;
  const alt = [...prefixes].map((p) => p.replace(/[^\w\s]/g, "\\$&")).join("|");
  return new RegExp(`^(?:${alt})?[\\p{L}\\p{N}_$]*$`, "u");
}

function appendAdditionalEdits(view: EditorView, edits: TextEdit[] | undefined, limit: number) {
  if (!edits?.length) return;
  const doc = view.state.doc;
  const changes = [];
  for (const e of edits) {
    const from = toOffset(doc, e.range.start);
    const to = toOffset(doc, e.range.end);
    if (from == null || to == null || to > limit) continue;
    changes.push({ from, to, insert: e.newText });
  }
  if (changes.length) view.dispatch({ changes, userEvent: "input.complete" });
}

function renderInfo(plugin: LSPPlugin, item: Item): Node | null {
  if (!item.detail && !item.documentation) return null;
  const root = document.createElement("div");
  root.className = "outline-completion-info";
  if (item.detail) {
    const head = document.createElement("div");
    head.className = "outline-completion-info-detail";
    head.textContent = item.detail;
    root.appendChild(head);
  }
  if (item.documentation) {
    const body = document.createElement("div");
    body.className = "cm-lsp-documentation outline-completion-info-doc";
    body.innerHTML = plugin.docToHTML(item.documentation);
    root.appendChild(body);
  }
  return root;
}

export const lspCompletionSource: CompletionSource = async (ctx: CompletionContext) => {
  const plugin = ctx.view && LSPPlugin.get(ctx.view);
  if (!plugin) return null;
  const provider = plugin.client.serverCapabilities?.completionProvider;
  if (!provider) return null;
  const ch = ctx.state.sliceDoc(ctx.pos - 1, ctx.pos);
  const word = ctx.matchBefore(wordBefore);
  let context: { triggerKind: number; triggerCharacter?: string };
  if (ctx.explicit) context = { triggerKind: 1 };
  else if (provider.triggerCharacters?.includes(ch) && ch !== " ") context = { triggerKind: 2, triggerCharacter: ch };
  else if (word && /[\p{L}_$]/u.test(word.text[0])) context = { triggerKind: 1 };
  else return null;

  plugin.client.sync();
  const params = { textDocument: { uri: plugin.uri }, position: plugin.toPosition(ctx.pos, ctx.state.doc), context };
  ctx.addEventListener("abort", () => plugin.client.cancelRequest(params));
  let raw: Item[] | ItemList | null;
  try {
    raw = await plugin.client.request<typeof params, Item[] | ItemList | null>("textDocument/completion", params);
  } catch {
    return null;
  }
  if (!raw) return null;
  const list: ItemList = Array.isArray(raw) ? { items: raw } : raw;
  if (!list.items.length) return null;

  const doc = ctx.state.doc;
  const defaultRange = list.itemDefaults?.editRange;
  const firstEdit = list.items[0].textEdit;
  const range = defaultRange
    ? "insert" in defaultRange
      ? defaultRange.insert
      : defaultRange
    : firstEdit
      ? (firstEdit.range ?? firstEdit.insert)
      : undefined;
  let from = word ? word.from : ctx.pos;
  if (range) from = toOffset(doc, range.start) ?? from;

  const sortKeys = [...new Set(list.items.map((i) => i.sortText ?? i.label))].sort();
  const rank = new Map(sortKeys.map((k, i) => [k, i]));
  const spread = Math.max(1, sortKeys.length - 1);
  const resolveSupported = !!provider.resolveProvider;
  const resolved = new Map<Item, Promise<Item>>();
  const resolve = (item: Item) => {
    if (!resolveSupported || (item.documentation && item.additionalTextEdits)) return Promise.resolve(item);
    let p = resolved.get(item);
    if (!p) {
      p = plugin.client.request<Item, Item>("completionItem/resolve", item).catch(() => item);
      resolved.set(item, p);
    }
    return p;
  };
  const done = new Map<Item, Item>();

  const options: Completion[] = list.items.map((item) => {
    const text = item.textEdit?.newText ?? item.textEditText ?? item.insertText ?? item.label;
    const isSnippet = (item.insertTextFormat ?? list.itemDefaults?.insertTextFormat) === 2;
    const label = item.filterText ?? item.label;
    const display = item.label + (item.labelDetails?.detail ?? "");
    const option: Completion = {
      label,
      displayLabel: display === label ? undefined : display,
      detail: item.labelDetails?.description,
      type: kinds[item.kind ?? 1] ?? "text",
      boost: -Math.round((99 * (rank.get(item.sortText ?? item.label) ?? 0)) / spread),
      info: () =>
        resolve(item).then((full) => {
          done.set(item, full);
          return renderInfo(plugin, full);
        }),
      apply: (view, completion, start, end) => {
        if (isSnippet) snippet(lspToSnippet(text))(view, completion, start, end);
        else view.dispatch({ ...insertCompletionText(view.state, text, start, end), annotations: pickedCompletion.of(completion) });
        const line = view.state.doc.lineAt(view.state.selection.main.head);
        const known = done.get(item) ?? (item.additionalTextEdits ? item : null);
        if (known) appendAdditionalEdits(view, known.additionalTextEdits, line.from);
        else if (resolveSupported) {
          const snapshot = view.state.doc;
          resolve(item).then((full) => {
            if (view.state.doc !== snapshot) return;
            appendAdditionalEdits(view, full.additionalTextEdits, line.from);
          });
        }
      },
    };
    return option;
  });

  return {
    from,
    options,
    validFor: list.isIncomplete ? undefined : validFor(list.items),
    getMatch: (completion, matched) =>
      matched && completion.displayLabel?.startsWith(completion.label) ? matched : [],
  } satisfies CompletionResult;
};

const wordCache = new WeakMap<Text, string[]>();
const scanLimit = 400_000;

function wordsIn(text: string, out: Set<string>) {
  const re = /[\p{L}_$][\p{L}\p{N}_$]{2,}/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.add(m[0]);
}

function cachedWords(doc: Text): string[] {
  let words = wordCache.get(doc);
  if (!words) {
    const set = new Set<string>();
    wordsIn(doc.sliceString(0, Math.min(doc.length, scanLimit)), set);
    words = [...set];
    wordCache.set(doc, words);
  }
  return words;
}

let otherDocs: () => Text[] = () => [];
export function setOtherDocsProvider(fn: () => Text[]) {
  otherDocs = fn;
}

async function languageResult(ctx: CompletionContext): Promise<CompletionResult | null> {
  const sources = ctx.state.languageDataAt<CompletionSource | readonly (string | Completion)[]>("autocomplete", ctx.pos);
  if (!sources.length) return null;
  const results = await Promise.all(
    sources.map((s) => Promise.resolve(typeof s === "function" ? s(ctx) : completeFromList(s)(ctx)).catch(() => null)),
  );
  const valid = results.filter((r): r is CompletionResult => !!r && r.options.length > 0);
  if (!valid.length) return null;
  const base = valid[0];
  const same = valid.filter((r) => r.from === base.from);
  return { from: base.from, options: same.flatMap((r) => r.options) };
}

export const localCompletionSource: CompletionSource = async (ctx) => {
  if (ctx.view && LSPPlugin.get(ctx.view)) return null;
  const word = ctx.matchBefore(wordBefore);
  if (!ctx.explicit && !word) {
    const lang = await languageResult(ctx);
    return lang;
  }
  const from = word ? word.from : ctx.pos;
  const lang = await languageResult(ctx);
  if (lang && lang.from !== from) return lang;

  const seen = new Set<string>((lang?.options ?? []).map((o) => o.label));
  const current = word ? word.text : "";
  const words = new Set<string>();
  const doc = ctx.state.doc;
  const before = doc.sliceString(Math.max(0, from - scanLimit / 2), from);
  const after = doc.sliceString(word ? word.to : ctx.pos, Math.min(doc.length, ctx.pos + scanLimit / 2));
  wordsIn(before, words);
  wordsIn(after, words);
  for (const other of otherDocs()) if (other !== doc) for (const w of cachedWords(other)) words.add(w);

  const options: Completion[] = [...(lang?.options ?? [])];
  for (const w of words) {
    if (w === current || seen.has(w)) continue;
    options.push({ label: w, type: "text", boost: -50 });
  }
  if (!options.length) return null;
  return { from, options, validFor: wordOnly };
};

const kindIcons: Record<string, { svg: string; color: string }> = {};
const svg = {
  box: "<path d='M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z'/><path d='m3.3 7 8.7 5 8.7-5'/><path d='M12 22V12'/>",
  variable:
    "<path d='M8 21s-4-3-4-9 4-9 4-9'/><path d='M16 3s4 3 4 9-4 9-4 9'/><line x1='15' x2='9' y1='9' y2='15'/><line x1='9' x2='15' y1='9' y2='15'/>",
  wrench:
    "<path d='M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z'/>",
  component:
    "<path d='M15.536 11.293a1 1 0 0 0 0 1.414l2.376 2.377a1 1 0 0 0 1.414 0l2.377-2.377a1 1 0 0 0 0-1.414l-2.377-2.377a1 1 0 0 0-1.414 0z'/><path d='M2.297 11.293a1 1 0 0 0 0 1.414l2.377 2.377a1 1 0 0 0 1.414 0l2.377-2.377a1 1 0 0 0 0-1.414L6.088 8.916a1 1 0 0 0-1.414 0z'/><path d='M8.916 17.912a1 1 0 0 0 0 1.415l2.377 2.376a1 1 0 0 0 1.414 0l2.377-2.376a1 1 0 0 0 0-1.415l-2.377-2.376a1 1 0 0 0-1.414 0z'/><path d='M8.916 4.674a1 1 0 0 0 0 1.414l2.377 2.376a1 1 0 0 0 1.414 0l2.377-2.376a1 1 0 0 0 0-1.414l-2.377-2.377a1 1 0 0 0-1.414 0z'/>",
  plug: "<path d='M12 22v-5'/><path d='M15 8V2'/><path d='M17 8a1 1 0 0 1 1 1v4a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1z'/><path d='M9 8V2'/>",
  list: "<path d='M11 5h10'/><path d='M11 12h10'/><path d='M11 19h10'/><path d='M4 4h1v5'/><path d='M4 9h2'/><path d='M6.5 20H3.4c0-1 2.6-1.925 2.6-3.5a1.5 1.5 0 0 0-2.6-1.02'/>",
  key: "<path d='M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z'/><circle cx='16.5' cy='7.5' r='.5' fill='black'/>",
  braces:
    "<path d='M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1'/><path d='M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1'/>",
  type: "<path d='M12 4v16'/><path d='M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2'/><path d='M9 20h6'/>",
  word: "<circle cx='7' cy='12' r='3'/><path d='M10 9v6'/><circle cx='17' cy='12' r='3'/><path d='M14 7v8'/><path d='M22 17v1c0 .5-.5 1-1 1H3c-.5 0-1-.5-1-1v-1'/>",
  snippet:
    "<path d='M5 3a2 2 0 0 0-2 2'/><path d='M19 3a2 2 0 0 1 2 2'/><path d='M21 19a2 2 0 0 1-2 2'/><path d='M5 21a2 2 0 0 1-2-2'/><path d='M9 3h1'/><path d='M9 21h1'/><path d='M14 3h1'/><path d='M14 21h1'/><path d='M3 9v1'/><path d='M21 9v1'/><path d='M3 14v1'/><path d='M21 14v1'/>",
  hash: "<line x1='4' x2='20' y1='9' y2='9'/><line x1='4' x2='20' y1='15' y2='15'/><line x1='10' x2='8' y1='3' y2='21'/><line x1='16' x2='14' y1='3' y2='21'/>",
  file: "<path d='M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z'/><path d='M14 2v5a1 1 0 0 0 1 1h5'/>",
  folder:
    "<path d='M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z'/>",
  zap: "<path d='M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z'/>",
  link: "<path d='M9 17H7A5 5 0 0 1 7 7h2'/><path d='M15 7h2a5 5 0 1 1 0 10h-2'/><line x1='8' x2='16' y1='12' y2='12'/>",
  asterisk: "<rect width='18' height='18' x='3' y='3' rx='2'/><path d='M12 8v8'/><path d='m8.5 14 7-4'/><path d='m8.5 10 7 4'/>",
  diamond:
    "<path d='M2.7 10.3a2.41 2.41 0 0 0 0 3.41l7.59 7.59a2.41 2.41 0 0 0 3.41 0l7.59-7.59a2.41 2.41 0 0 0 0-3.41l-7.59-7.59a2.41 2.41 0 0 0-3.41 0Z'/>",
  shapes:
    "<path d='M8.3 10a.7.7 0 0 1-.626-1.079L11.4 3a.7.7 0 0 1 1.198-.043L16.3 8.9a.7.7 0 0 1-.572 1.1Z'/><rect x='3' y='14' width='7' height='7' rx='1'/><circle cx='17.5' cy='17.5' r='3.5'/>",
};
const purple = "#8b45c7";
const blue = "#1a7fd4";
const orange = "#d0790a";
const gray = "#6e6e76";
const teal = "#14877b";
const assign = (types: string[], icon: string, color: string) => {
  for (const t of types) kindIcons[t] = { svg: icon, color };
};
assign(["method", "function", "constructor"], svg.box, purple);
assign(["variable", "field"], svg.variable, blue);
assign(["property"], svg.wrench, gray);
assign(["class", "struct"], svg.component, orange);
assign(["interface"], svg.plug, blue);
assign(["module", "namespace"], svg.braces, gray);
assign(["enum"], svg.list, orange);
assign(["enum-member"], svg.diamond, blue);
assign(["constant", "value"], svg.asterisk, gray);
assign(["keyword"], svg.key, gray);
assign(["snippet"], svg.snippet, gray);
assign(["text"], svg.word, gray);
assign(["type", "type-parameter"], svg.type, teal);
assign(["file"], svg.file, gray);
assign(["folder"], svg.folder, gray);
assign(["reference"], svg.link, gray);
assign(["event"], svg.zap, orange);
assign(["operator", "unit"], svg.hash, gray);
assign(["color"], svg.shapes, gray);

const iconStyles: Record<string, Record<string, string>> = {};
for (const [type, { svg: body, color }] of Object.entries(kindIcons)) {
  const markup = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>${body}</svg>`;
  const url = `url("data:image/svg+xml,${encodeURIComponent(markup)}")`;
  iconStyles[`.cm-completionIcon-${type}:after`] = {
    content: "''",
    backgroundColor: color,
    maskImage: url,
    WebkitMaskImage: url,
  };
}

const completionTheme = EditorView.theme({
  ".cm-tooltip.cm-tooltip-autocomplete": { padding: "0", overflow: "visible" },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": {
    fontFamily: "var(--font-mono)",
    fontSize: "calc(var(--editor-font-size) * 0.86)",
    padding: "4px",
    maxHeight: "18em",
    minWidth: "320px",
    maxWidth: "min(620px, 70vw)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
    display: "flex",
    alignItems: "center",
    gap: "0",
    padding: "1px 8px 1px 4px !important",
    borderRadius: "5px",
    lineHeight: "1.75",
  },
  ".cm-completionIcon": {
    width: "16px",
    height: "16px",
    padding: "0",
    marginRight: "8px",
    opacity: "1",
    flexShrink: "0",
    position: "relative",
    boxSizing: "content-box",
  },
  ".cm-completionIcon:after": {
    content: "''",
    position: "absolute",
    inset: "1px",
    maskSize: "contain",
    WebkitMaskSize: "contain",
    maskRepeat: "no-repeat",
    WebkitMaskRepeat: "no-repeat",
    maskPosition: "center",
    WebkitMaskPosition: "center",
    backgroundColor: "#6e6e76",
  },
  ...iconStyles,
  ".cm-completionLabel": { whiteSpace: "pre", overflow: "hidden", textOverflow: "ellipsis", flexShrink: "1", minWidth: "0" },
  ".cm-completionDetail": {
    marginLeft: "auto",
    paddingLeft: "18px",
    fontStyle: "normal",
    color: "var(--muted)",
    fontFamily: "var(--font-ui)",
    fontSize: "0.88em",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: "50%",
    flexShrink: "0",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--accent-soft)", color: "inherit" },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionMatchedText": { color: "var(--accent-text)" },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionDetail": { color: "var(--muted)" },
  "&:not(.cm-focused) .cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--hover)" },
  ".cm-completionMatchedText": { textDecoration: "none", color: "var(--accent-text)", fontWeight: "650" },
  ".cm-tooltip.cm-completionInfo": {
    padding: "0",
    backgroundColor: "var(--pop-bg-strong)",
    backdropFilter: "blur(28px) saturate(180%)",
    borderRadius: "10px",
    boxShadow: "var(--shadow-pop)",
    border: "none",
    maxWidth: "440px",
    maxHeight: "320px",
    overflowY: "auto",
    marginLeft: "4px",
  },
  ".outline-completion-info": { padding: "8px 12px", fontFamily: "var(--font-ui)", fontSize: "12.5px", lineHeight: "1.5" },
  ".outline-completion-info-detail": {
    fontFamily: "var(--font-mono)",
    fontSize: "12px",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    color: "var(--text-soft)",
  },
  ".outline-completion-info-detail + .outline-completion-info-doc": {
    marginTop: "7px",
    paddingTop: "7px",
    borderTop: "1px solid var(--line)",
  },
  ".cm-lsp-documentation": { padding: "0" },
  ".cm-lsp-documentation p": { margin: "3px 0" },
  ".cm-lsp-documentation pre, .cm-lsp-documentation code": { fontFamily: "var(--font-mono)", fontSize: "12px" },
  ".cm-lsp-documentation pre": { whiteSpace: "pre-wrap", margin: "4px 0" },
});

export function completionExtensions(): Extension[] {
  return [
    autocompletion({
      override: [lspCompletionSource, localCompletionSource],
      icons: true,
      activateOnTypingDelay: 30,
      maxRenderedOptions: 120,
      tooltipClass: () => "outline-completion",
      interactionDelay: 0,
    }),
    Prec.highest(
      keymap.of([
        { key: "Tab", run: acceptCompletion },
        { key: "Mod-i", run: startCompletion },
        { key: "Alt-Escape", run: startCompletion },
      ]),
    ),
    completionTheme,
  ];
}
