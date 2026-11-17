import { Channel, invoke } from "@tauri-apps/api/core";
import {
  LSPClient,
  LSPPlugin,
  Workspace,
  findReferencesKeymap,
  formatKeymap,
  hoverTooltips,
  jumpToDefinition,
  jumpToDefinitionKeymap,
  renameKeymap,
  signatureHelp,
  type Transport,
  type WorkspaceFile,
} from "@codemirror/lsp-client";
import type { ChangeSet, Extension, Text } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { get, set, type Problem } from "../store";

type ServerId = "typescript" | "rust" | "swift" | "c" | "go" | "python" | "css" | "html" | "json";
type LspEvent = { kind: "Message"; data: string } | { kind: "Exit" };

const byExtension: Record<string, [ServerId, string]> = {
  ts: ["typescript", "typescript"],
  mts: ["typescript", "typescript"],
  cts: ["typescript", "typescript"],
  tsx: ["typescript", "typescriptreact"],
  js: ["typescript", "javascript"],
  mjs: ["typescript", "javascript"],
  cjs: ["typescript", "javascript"],
  jsx: ["typescript", "javascriptreact"],
  rs: ["rust", "rust"],
  swift: ["swift", "swift"],
  c: ["c", "c"],
  h: ["c", "c"],
  cc: ["c", "cpp"],
  cpp: ["c", "cpp"],
  cxx: ["c", "cpp"],
  hpp: ["c", "cpp"],
  m: ["c", "objective-c"],
  mm: ["c", "objective-cpp"],
  go: ["go", "go"],
  py: ["python", "python"],
  css: ["css", "css"],
  scss: ["css", "scss"],
  less: ["css", "less"],
  html: ["html", "html"],
  htm: ["html", "html"],
  json: ["json", "json"],
  jsonc: ["json", "jsonc"],
};

export const pathToUri = (path: string) => "file://" + path.split("/").map(encodeURIComponent).join("/");
export const uriToPath = (uri: string) => decodeURIComponent(uri.replace(/^file:\/\//, ""));

type RawDiagnostic = {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  severity?: number;
  message: string;
  source?: string;
  code?: string | number;
};

const pushed = new Map<string, Problem[]>();
const pulled = new Map<string, Problem[]>();

function toProblems(path: string, items: RawDiagnostic[]): Problem[] {
  return items.map((d) => ({
    path,
    line: d.range.start.line,
    col: d.range.start.character,
    endLine: d.range.end.line,
    endCol: d.range.end.character,
    severity: (d.severity ?? 1) as Problem["severity"],
    message: d.message,
    source: d.source,
    code: d.code == null ? undefined : String(d.code),
  }));
}

function publish(path: string) {
  const list = [...(pushed.get(path) ?? []), ...(pulled.get(path) ?? [])];
  set((s) => {
    const problems = { ...s.problems };
    if (list.length) problems[path] = list;
    else delete problems[path];
    return { problems };
  });
}

function clearProblems(path?: string) {
  if (path == null) {
    pushed.clear();
    pulled.clear();
    set({ problems: {} });
    return;
  }
  pushed.delete(path);
  pulled.delete(path);
  publish(path);
}

class TauriTransport implements Transport {
  private handlers = new Set<(value: string) => void>();
  onRegister: (methods: string[]) => void = () => {};
  constructor(private id: number) {}
  send(message: string) {
    invoke("lsp_send", { id: this.id, message }).catch(() => {});
  }
  private reply(id: unknown, result: unknown) {
    this.send(JSON.stringify({ jsonrpc: "2.0", id, result }));
  }
  private intercept(message: string) {
    if (!message.includes('"method"') || !message.includes('"id"')) return false;
    let value: { id?: unknown; method?: string; params?: any };
    try {
      value = JSON.parse(message);
    } catch {
      return false;
    }
    if (value.id == null || !value.method) return false;
    switch (value.method) {
      case "client/registerCapability":
        this.onRegister((value.params?.registrations ?? []).map((r: { method: string }) => r.method));
        this.reply(value.id, null);
        return true;
      case "client/unregisterCapability":
      case "window/workDoneProgress/create":
        this.reply(value.id, null);
        return true;
      case "workspace/applyEdit": {
        const id = value.id;
        applyEditHandler(value.params?.edit ?? {})
          .then((applied) => this.reply(id, { applied }))
          .catch(() => this.reply(id, { applied: false }));
        return true;
      }
      case "workspace/configuration":
        this.reply(value.id, (value.params?.items ?? []).map(() => null));
        return true;
      case "workspace/diagnostic/refresh":
        this.reply(value.id, null);
        this.onRegister(["workspace/diagnostic/refresh"]);
        return true;
    }
    return false;
  }
  subscribe(handler: (value: string) => void) {
    this.handlers.add(handler);
  }
  unsubscribe(handler: (value: string) => void) {
    this.handlers.delete(handler);
  }
  emit(message: string) {
    if (this.intercept(message)) return;
    for (const h of this.handlers) h(message);
  }
}

class OutlineFile implements WorkspaceFile {
  view: EditorView | null = null;
  constructor(
    public uri: string,
    public languageId: string,
    public version: number,
    public doc: Text,
  ) {}
  getView() {
    return this.view;
  }
}

export type WorkspaceEdit = {
  changes?: Record<string, TextEdit[]>;
  documentChanges?: ({ textDocument: { uri: string }; edits: TextEdit[] } | { kind: string })[];
};
type LspCommand = { title: string; command: string; arguments?: unknown[] };
export type CodeAction = {
  title: string;
  kind?: string;
  isPreferred?: boolean;
  disabled?: { reason: string };
  edit?: WorkspaceEdit;
  command?: LspCommand | string;
  arguments?: unknown[];
  data?: unknown;
};

let applyEditHandler: (edit: WorkspaceEdit) => Promise<boolean> = async () => false;
export function setApplyEditHandler(fn: (edit: WorkspaceEdit) => Promise<boolean>) {
  applyEditHandler = fn;
}

let exitHandler: (server: string) => void = () => {};
export function setServerExitHandler(fn: (server: string) => void) {
  exitHandler = fn;
}

let displayHandler: ((path: string) => Promise<EditorView | null>) | null = null;
export function setDisplayHandler(fn: (path: string) => Promise<EditorView | null>) {
  displayHandler = fn;
}

class OutlineWorkspace extends Workspace {
  files: OutlineFile[] = [];

  syncFiles(): ReturnType<Workspace["syncFiles"]> {
    const updates: { file: WorkspaceFile; prevDoc: Text; changes: ChangeSet }[] = [];
    for (const file of this.files) {
      if (!file.view) continue;
      const plugin = LSPPlugin.get(file.view);
      if (!plugin || plugin.uri !== file.uri) continue;
      const changes = plugin.unsyncedChanges;
      if (changes.empty) continue;
      updates.push({ changes, file, prevDoc: file.doc });
      file.doc = file.view.state.doc;
      file.version++;
      plugin.clear();
    }
    return updates;
  }

  openFile(uri: string, languageId: string, view: EditorView) {
    const existing = this.getFile(uri) as OutlineFile | null;
    if (!existing) {
      const file = new OutlineFile(uri, languageId, 0, view.state.doc);
      file.view = view;
      this.files.push(file);
      this.client.didOpen(file);
      return;
    }
    existing.view = view;
    if (!existing.doc.eq(view.state.doc)) {
      existing.doc = view.state.doc;
      existing.version++;
      this.client.notification("textDocument/didChange", {
        textDocument: { uri, version: existing.version },
        contentChanges: [{ text: existing.doc.toString() }],
      });
    }
  }

  closeFile(uri: string, view: EditorView) {
    const file = this.getFile(uri) as OutlineFile | null;
    if (file && file.view === view) file.view = null;
  }

  release(uri: string) {
    const file = this.getFile(uri);
    if (!file) return;
    this.files = this.files.filter((f) => f !== file);
    if (this.client.connected) this.client.didClose(uri);
  }

  displayFile(uri: string): Promise<EditorView | null> {
    const file = this.getFile(uri) as OutlineFile | null;
    if (file?.view) return Promise.resolve(file.view);
    return displayHandler ? displayHandler(uriToPath(uri)) : Promise.resolve(null);
  }
}

const goToDefinitionOnClick = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (!event.metaKey || event.button !== 0 || event.altKey || event.shiftKey) return false;
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos == null) return false;
    event.preventDefault();
    view.dispatch({ selection: { anchor: pos } });
    jumpToDefinition(view);
    return true;
  },
});

const lspTheme = EditorView.theme({
  ".cm-tooltip-hover, .cm-tooltip.cm-lsp-signature-tooltip": {
    maxWidth: "560px",
    fontFamily: "var(--font-ui)",
    fontSize: "12.5px",
    lineHeight: "1.5",
  },
  ".cm-tooltip-hover .cm-lsp-documentation": { padding: "8px 12px", maxHeight: "340px", overflowY: "auto" },
  ".cm-lsp-documentation pre, .cm-lsp-documentation code": { fontFamily: "var(--font-mono)", fontSize: "12px" },
  ".cm-lsp-documentation pre": { whiteSpace: "pre-wrap", margin: "4px 0" },
  ".cm-lsp-documentation p": { margin: "4px 0" },
  ".cm-lsp-documentation hr": { border: "none", borderTop: "1px solid var(--line)", margin: "6px 0" },
  ".cm-tooltip.cm-lsp-signature-tooltip": { padding: "6px 12px", borderRadius: "8px" },
  ".cm-lsp-signature": { fontFamily: "var(--font-mono)", fontSize: "12.5px" },
  ".cm-lsp-active-parameter": { color: "var(--accent-text)", fontWeight: "650" },
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
  ".cm-tooltip-lint": { fontFamily: "var(--font-ui)", fontSize: "12.5px" },
  ".cm-diagnostic": { padding: "6px 12px", borderLeft: "3px solid transparent" },
  ".cm-diagnostic-error": { borderLeftColor: "#e5484d" },
  ".cm-diagnostic-warning": { borderLeftColor: "#d68c00" },
});

const editorExtensions: Extension[] = [
  hoverTooltips({ hoverTime: 400 }),
  signatureHelp(),
  keymap.of([...formatKeymap, ...renameKeymap, ...jumpToDefinitionKeymap, ...findReferencesKeymap]),
  goToDefinitionOnClick,
  lspTheme,
];

type Entry = {
  id: number;
  client: LSPClient;
  workspace: OutlineWorkspace;
  ready: Promise<LSPClient | null>;
  pull: boolean;
  pullTimer?: number;
};

const clients = new Map<string, Entry>();
const unavailable = new Set<string>();
const fileClient = new Map<string, Entry>();
let nextId = 1;

function start(server: ServerId, root: string): Entry | null {
  const key = `${server}\u0000${root}`;
  const existing = clients.get(key);
  if (existing) return existing;
  if (unavailable.has(key)) return null;

  const id = nextId++;
  const transport = new TauriTransport(id);
  const client = new LSPClient({
    rootUri: pathToUri(root),
    timeout: 10000,
    workspace: (c) => new OutlineWorkspace(c),
    extensions: [
      {
        clientCapabilities: {
          textDocument: {
            diagnostic: { dynamicRegistration: true, relatedDocumentSupport: false },
            publishDiagnostics: { relatedInformation: false },
            documentSymbol: { hierarchicalDocumentSymbolSupport: true },
            completion: {
              completionItem: {
                labelDetailsSupport: true,
                resolveSupport: { properties: ["documentation", "detail", "additionalTextEdits"] },
              },
            },
            synchronization: { didSave: true },
          },
        },
      },
      ...editorExtensions,
    ],
    notificationHandlers: {
      "textDocument/publishDiagnostics": (_c, params: { uri: string; diagnostics: RawDiagnostic[] }) => {
        const path = uriToPath(params.uri);
        if (!fileClient.has(path)) return true;
        pushed.set(path, toProblems(path, params.diagnostics));
        publish(path);
        return true;
      },
      "window/logMessage": () => true,
      "window/showMessage": () => true,
      "$/progress": () => true,
    },
    unhandledNotification: () => {},
  });

  const channel = new Channel<LspEvent>();
  const entry: Entry = { id, client, workspace: client.workspace as OutlineWorkspace, ready: Promise.resolve(null), pull: false };
  transport.onRegister = (methods) => {
    if (methods.some((m) => m === "textDocument/diagnostic" || m === "workspace/diagnostic/refresh")) {
      entry.pull = true;
      schedulePull(entry, 50);
    }
  };
  channel.onmessage = (event) => {
    if (event.kind === "Message") transport.emit(event.data);
    else {
      // stopAll() removes entries before stopping them, so a server that is still
      // registered here exited on its own (crashed or was killed).
      if (clients.get(key) === entry && client.connected) exitHandler(server);
      clients.delete(key);
      for (const [path, e] of fileClient) if (e === entry) fileClient.delete(path);
      if (client.connected) client.disconnect();
    }
  };
  entry.ready = invoke("lsp_start", { id, server, root, onEvent: channel })
    .then(() => client.connect(transport).initializing)
    .then(() => {
      if (client.serverCapabilities?.diagnosticProvider) entry.pull = true;
      return client;
    })
    .catch(() => {
      unavailable.add(key);
      clients.delete(key);
      invoke("lsp_stop", { id }).catch(() => {});
      return null;
    });
  clients.set(key, entry);
  return entry;
}

function schedulePull(entry: Entry, delay = 450) {
  if (!entry.pull) return;
  window.clearTimeout(entry.pullTimer);
  entry.pullTimer = window.setTimeout(() => pullAll(entry), delay);
}

async function pullAll(entry: Entry) {
  const { client, workspace } = entry;
  if (!client.connected) return;
  try {
    client.sync();
  } catch {}
  await Promise.all(
    workspace.files.map(async (file) => {
      const path = uriToPath(file.uri);
      try {
        const report = await client.request<unknown, { kind: string; items?: RawDiagnostic[] }>("textDocument/diagnostic", {
          textDocument: { uri: file.uri },
        });
        if (report?.kind === "full" && fileClient.has(path)) {
          pulled.set(path, toProblems(path, report.items ?? []));
          publish(path);
        }
      } catch (e) {
        if ((e as { code?: number })?.code === -32601) entry.pull = false;
      }
    }),
  );
}

export type SymbolItem = {
  name: string;
  detail?: string;
  kind: number;
  path: string;
  line: number;
  col: number;
  container?: string;
  depth: number;
};

type LspRange = { start: { line: number; character: number }; end: { line: number; character: number } };
type DocumentSymbol = { name: string; detail?: string; kind: number; range: LspRange; selectionRange: LspRange; children?: DocumentSymbol[] };
type SymbolInformation = { name: string; kind: number; containerName?: string; location: { uri: string; range: LspRange } };
export type TextEdit = { range: LspRange; newText: string };

function flattenSymbols(path: string, list: (DocumentSymbol | SymbolInformation)[], depth = 0, container?: string): SymbolItem[] {
  const out: SymbolItem[] = [];
  for (const s of list) {
    if ("location" in s) {
      out.push({ name: s.name, kind: s.kind, path: uriToPath(s.location.uri), line: s.location.range.start.line, col: s.location.range.start.character, container: s.containerName, depth: 0 });
      continue;
    }
    out.push({ name: s.name, detail: s.detail, kind: s.kind, path, line: s.selectionRange.start.line, col: s.selectionRange.start.character, container, depth });
    if (s.children?.length) out.push(...flattenSymbols(path, s.children, depth + 1, s.name));
  }
  return out;
}

function serverFor(path: string): [ServerId, string] | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  return byExtension[name.slice(dot + 1).toLowerCase()] ?? null;
}

export const lsp = {
  async attach(path: string, root: string | null): Promise<Extension | null> {
    const match = serverFor(path);
    if (!match) return null;
    const [server, languageId] = match;
    const base = root && path.startsWith(root + "/") ? root : path.slice(0, path.lastIndexOf("/")) || "/";
    const entry = start(server, base);
    if (!entry) return null;
    const client = await entry.ready;
    if (!client) return null;
    fileClient.set(path, entry);
    schedulePull(entry, 600);
    return client.plugin(pathToUri(path), languageId);
  },

  release(path: string) {
    const entry = fileClient.get(path);
    clearProblems(path);
    if (!entry) return;
    fileClient.delete(path);
    entry.workspace.release(pathToUri(path));
  },

  changed(path: string) {
    const entry = fileClient.get(path);
    if (entry) schedulePull(entry);
  },

  saved(path: string) {
    const entry = fileClient.get(path);
    if (!entry || !entry.client.connected) return;
    entry.client.notification("textDocument/didSave", { textDocument: { uri: pathToUri(path) } });
    schedulePull(entry, 150);
  },

  async documentSymbols(path: string): Promise<SymbolItem[] | null> {
    const entry = fileClient.get(path);
    if (!entry?.client.connected || !entry.client.serverCapabilities?.documentSymbolProvider) return null;
    try {
      entry.client.sync();
      const result = await entry.client.request<unknown, (DocumentSymbol | SymbolInformation)[] | null>("textDocument/documentSymbol", {
        textDocument: { uri: pathToUri(path) },
      });
      return flattenSymbols(path, result ?? []);
    } catch {
      return null;
    }
  },

  async workspaceSymbols(query: string): Promise<SymbolItem[]> {
    const seen = new Set<Entry>();
    const results: SymbolItem[] = [];
    for (const entry of fileClient.values()) {
      if (seen.has(entry)) continue;
      seen.add(entry);
      if (!entry.client.connected || !entry.client.serverCapabilities?.workspaceSymbolProvider) continue;
      try {
        const list = await entry.client.request<unknown, SymbolInformation[] | null>("workspace/symbol", { query });
        for (const s of list ?? []) {
          if (!s.location?.range) continue;
          results.push({
            name: s.name,
            kind: s.kind,
            path: uriToPath(s.location.uri),
            line: s.location.range.start.line,
            col: s.location.range.start.character,
            container: s.containerName,
            depth: 0,
          });
        }
      } catch {}
    }
    return results;
  },

  hasWorkspaceSymbols() {
    for (const entry of fileClient.values()) if (entry.client.serverCapabilities?.workspaceSymbolProvider) return true;
    return false;
  },

  async codeActions(
    path: string,
    range: LspRange,
    only?: string[],
  ): Promise<CodeAction[] | null> {
    const entry = fileClient.get(path);
    if (!entry?.client.connected || !entry.client.serverCapabilities?.codeActionProvider) return null;
    const diagnostics = (get().problems[path] ?? [])
      .filter((p) => p.endLine >= range.start.line && p.line <= range.end.line)
      .map((p) => ({
        range: { start: { line: p.line, character: p.col }, end: { line: p.endLine, character: p.endCol } },
        severity: p.severity,
        message: p.message,
        source: p.source,
        code: p.code != null && /^\d+$/.test(p.code) ? Number(p.code) : p.code,
      }));
    try {
      entry.client.sync();
      const result = await entry.client.request<unknown, CodeAction[] | null>("textDocument/codeAction", {
        textDocument: { uri: pathToUri(path) },
        range,
        context: { diagnostics, ...(only ? { only } : {}), triggerKind: 1 },
      });
      return (result ?? []).filter((a) => !a.disabled);
    } catch {
      return null;
    }
  },

  async runCodeAction(path: string, action: CodeAction) {
    const entry = fileClient.get(path);
    if (!entry?.client.connected) return;
    const { client } = entry;
    if (typeof action.command === "string") {
      await client.request("workspace/executeCommand", { command: action.command, arguments: action.arguments }).catch(() => {});
      return;
    }
    let resolved = action;
    const provider = client.serverCapabilities?.codeActionProvider;
    if (!action.edit && provider && typeof provider === "object" && provider.resolveProvider) {
      resolved = await client.request<CodeAction, CodeAction>("codeAction/resolve", action).catch(() => action);
    }
    if (resolved.edit) await applyEditHandler(resolved.edit);
    const cmd = resolved.command;
    if (cmd && typeof cmd === "object") {
      await client.request("workspace/executeCommand", { command: cmd.command, arguments: cmd.arguments }).catch(() => {});
    }
  },

  async formatting(path: string, tabSize: number, insertSpaces: boolean): Promise<TextEdit[] | null> {
    const entry = fileClient.get(path);
    if (!entry?.client.connected || !entry.client.serverCapabilities?.documentFormattingProvider) return null;
    try {
      entry.client.sync();
      return await entry.client.request<unknown, TextEdit[] | null>("textDocument/formatting", {
        textDocument: { uri: pathToUri(path) },
        options: { tabSize, insertSpaces },
      });
    } catch {
      return null;
    }
  },

  stopAll() {
    for (const entry of clients.values()) {
      if (entry.client.connected) {
        entry.client.request("shutdown", null).catch(() => {});
        entry.client.disconnect();
      }
      invoke("lsp_stop", { id: entry.id }).catch(() => {});
    }
    clients.clear();
    fileClient.clear();
    unavailable.clear();
    clearProblems();
  },
};
