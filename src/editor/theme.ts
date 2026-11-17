import { EditorView, Decoration, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { RangeSetBuilder, Prec } from "@codemirror/state";
import { jsonLanguage } from "@codemirror/lang-json";
import { tags as t } from "@lezer/highlight";

const chrome = {
  fg: "var(--editor-fg)",
  cursor: "#0a84ff",
  selection: "rgba(10, 132, 255, 0.2)",
  lineNumber: "var(--editor-line-number)",
  lineNumberActive: "var(--editor-line-number-active)",
  invalid: "#e5484d",
};

export const editorTheme = EditorView.theme(
  {
    "&": {
      color: chrome.fg,
      backgroundColor: "transparent",
      height: "100%",
      fontSize: "var(--editor-font-size)",
    },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": {
      fontFamily: "var(--font-mono)",
      lineHeight: "1.78",
      fontVariantLigatures: "none",
      fontWeight: "var(--editor-font-weight)",
    },
    ".cm-content": { padding: "12px 0 24px", caretColor: chrome.cursor },
    ".cm-line": { padding: "0 28px 0 6px" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: chrome.cursor, borderLeftWidth: "2px" },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection": {
      backgroundColor: chrome.selection,
    },
    ".cm-selectionMatch": { backgroundColor: "rgba(10, 132, 255, 0.1)", borderRadius: "2px" },
    ".cm-activeLine": { backgroundColor: "var(--editor-active-line)" },
    ".cm-gutters": {
      backgroundColor: "transparent",
      fontSize: "0.9em",
      border: "none",
      color: chrome.lineNumber,
      paddingLeft: "14px",
      fontFamily: "var(--font-ui)",
      fontVariantNumeric: "tabular-nums",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      padding: "0 10px 0 6px",
      minWidth: "34px",
    },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: chrome.lineNumberActive },
    ".cm-foldGutter .cm-gutterElement": {
      color: "var(--editor-fold)",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: "14px",
      transition: "color 120ms",
    },
    ".cm-foldGutter .cm-gutterElement:hover": { color: chrome.fg },
    ".cm-foldPlaceholder": {
      backgroundColor: "rgba(10, 132, 255, 0.1)",
      border: "none",
      color: chrome.cursor,
      borderRadius: "4px",
      padding: "0 6px",
      margin: "0 4px",
    },
    "&.cm-focused .cm-matchingBracket": {
      backgroundColor: "rgba(10, 132, 255, 0.12)",
      outline: "1px solid rgba(10, 132, 255, 0.35)",
      borderRadius: "2px",
    },
    "&.cm-focused .cm-nonmatchingBracket": { backgroundColor: "rgba(213, 44, 54, 0.15)" },
    ".cm-searchMatch": { backgroundColor: "rgba(213, 169, 16, 0.25)", borderRadius: "2px" },
    ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "rgba(213, 144, 28, 0.45)" },
    ".cm-tooltip": {
      border: "none",
      backgroundColor: "var(--pop-bg)",
      color: "var(--text)",
      backdropFilter: "blur(28px) saturate(180%)",
      borderRadius: "10px",
      boxShadow: "var(--shadow-pop)",
      overflow: "hidden",
    },
    ".cm-panels": { backgroundColor: "var(--panel-bg)", color: chrome.fg },
    ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--line)" },
    ".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--line)" },
    ".cm-search": {
      display: "flex",
      flexWrap: "wrap",
      alignItems: "center",
      gap: "6px",
      padding: "8px 16px",
      fontFamily: "var(--font-ui)",
      fontSize: "12px",
    },
    ".cm-search br": { display: "none" },
    ".cm-search .cm-textfield": {
      fontFamily: "var(--font-mono)",
      fontSize: "12px",
      height: "26px",
      padding: "0 9px",
      borderRadius: "7px",
      border: "1px solid var(--line-strong)",
      backgroundColor: "var(--field-bg)",
      color: "var(--text)",
      outline: "none",
      minWidth: "200px",
      margin: "0",
    },
    ".cm-search .cm-textfield:focus": {
      borderColor: "rgba(10, 132, 255, 0.6)",
      boxShadow: "0 0 0 3px rgba(10, 132, 255, 0.15)",
    },
    ".cm-search .cm-button": {
      backgroundImage: "none",
      backgroundColor: "var(--button-bg)",
      border: "none",
      borderRadius: "7px",
      height: "26px",
      padding: "0 10px",
      margin: "0",
      color: chrome.fg,
      fontSize: "12px",
      textTransform: "capitalize",
    },
    ".cm-search .cm-button:hover": { backgroundColor: "var(--button-hover)" },
    ".cm-search label": {
      display: "inline-flex",
      alignItems: "center",
      gap: "4px",
      color: "var(--muted)",
      fontSize: "12px",
      textTransform: "capitalize",
      margin: "0 2px",
    },
    ".cm-search input[type=checkbox]": { accentColor: chrome.cursor, margin: "0" },
    ".cm-search button[name=close]": {
      marginLeft: "auto",
      fontSize: "16px",
      color: "var(--muted)",
      background: "none",
      border: "none",
      position: "static",
      padding: "0 4px",
    },
    ".cm-specialChar": { color: chrome.invalid },
    ".cm-diagnostic": { fontFamily: "var(--font-ui)" },
    ".cm-lintRange-error": {
      backgroundImage: "none",
      textDecoration: "underline wavy rgba(229, 72, 77, 0.85)",
      textDecorationSkipInk: "none",
      textUnderlineOffset: "3px",
    },
    ".cm-lintRange-warning": {
      backgroundImage: "none",
      textDecoration: "underline wavy rgba(214, 140, 0, 0.85)",
      textDecorationSkipInk: "none",
      textUnderlineOffset: "3px",
    },
    ".cm-lintRange-info, .cm-lintRange-hint": { backgroundImage: "none" },
    ".cm-lintRange-hint": { opacity: "0.75" },
    ".cm-tooltip-lint": { fontFamily: "var(--font-ui)", fontSize: "12.5px" },
    ".cm-diagnostic-error": { borderLeftColor: "#e5484d" },
    ".cm-diagnostic-warning": { borderLeftColor: "#d68c00" },
    ".cm-diagnosticSource": { color: "var(--muted)", fontSize: "11.5px" },
    "&.cm-merge-a .cm-changedLine, .cm-deletedChunk": { backgroundColor: "var(--diff-deleted-line)" },
    "&.cm-merge-b .cm-changedLine": { backgroundColor: "var(--diff-added-line)" },
    "&.cm-merge-a .cm-changedText, .cm-deletedChunk .cm-deletedText": { background: "var(--diff-deleted-text)" },
    "&.cm-merge-b .cm-changedText": { background: "var(--diff-added-text)" },
    "&.cm-merge-a .cm-changedLineGutter": { background: "var(--git-deleted)" },
    "&.cm-merge-b .cm-changedLineGutter": { background: "var(--git-added)" },
    ".cm-collapsedLines": {
      background: "var(--button-bg)",
      color: "var(--muted)",
      fontFamily: "var(--font-ui)",
      fontSize: "12px",
      padding: "4px 12px",
      cursor: "pointer",
    },
  },
  { dark: false },
);

const tk = (name: string) => `tk-${name}`;

export const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.bool, t.null, t.self, t.atom], class: tk("keyword") },
  { tag: [t.typeName, t.className, t.namespace], class: tk("type") },
  { tag: [t.string, t.special(t.string), t.character, t.regexp, t.escape, t.attributeValue], class: tk("string") },
  { tag: [t.number, t.integer, t.float], class: tk("number") },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], class: tk("comment") },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.function(t.definition(t.variableName))], class: tk("function") },
  { tag: [t.meta, t.annotation, t.attributeName], class: tk("attribute") },
  { tag: [t.macroName, t.processingInstruction], class: tk("preprocessor") },
  { tag: [t.tagName, t.heading], class: tk("variable") },
  { tag: [t.link, t.url], class: tk("link") },
  { tag: [t.strong], fontWeight: "700" },
  { tag: [t.emphasis], fontStyle: "italic" },
  { tag: [t.strikethrough], textDecoration: "line-through" },
  { tag: [t.heading], fontWeight: "600" },
  { tag: [t.invalid], color: chrome.invalid },
]);

const jsonKeys = HighlightStyle.define([{ tag: t.propertyName, class: tk("variable") }], { scope: jsonLanguage });

const typeMark = Decoration.mark({ class: tk("type") });
const identifierNode = /Name|Identifier|Definition|^variable|^def$|^property|^type/;
const capitalized = /^[A-Z][A-Za-z0-9_]*$/;

function capitalizedTypes(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const tree = syntaxTree(view.state);
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        if (node.node.firstChild || !identifierNode.test(node.name)) return;
        if (node.to - node.from > 80) return;
        if (capitalized.test(view.state.sliceDoc(node.from, node.to))) builder.add(node.from, node.to, typeMark);
      },
    });
  }
  return builder.finish();
}

const capitalizedTypePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = capitalizedTypes(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) {
        this.decorations = capitalizedTypes(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

export const editorHighlight = [syntaxHighlighting(highlight), syntaxHighlighting(jsonKeys), Prec.lowest(capitalizedTypePlugin)];
