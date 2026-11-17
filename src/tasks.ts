import { get } from "./store";
import { basename, dirname, fs, join } from "./lib/fs";
import { parseJsonc } from "./lib/settings";
import { isDiffPath } from "./lib/diffpath";
import { session } from "./editor/session";
import { saveFile, toast } from "./actions";
import { createTerminal, sendToTerminal } from "./terminal/manager";

export type Task = { label: string; command: string; detail: string; source: string };

const quote = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

async function readText(path: string) {
  try {
    return await fs.readFile(path);
  } catch {
    return null;
  }
}

function packageManager(names: Set<string>) {
  if (names.has("pnpm-lock.yaml")) return "pnpm";
  if (names.has("yarn.lock")) return "yarn";
  if (names.has("bun.lockb") || names.has("bun.lock")) return "bun";
  return "npm";
}

function makeTargets(text: string) {
  const targets = new Set<string>();
  for (const m of text.matchAll(/^([A-Za-z0-9][\w./-]*)\s*:(?!=)/gm)) targets.add(m[1]);
  return [...targets];
}

// Finds runnable tasks in the project root: package.json scripts, Deno tasks,
// Makefile targets, and the usual Cargo and Go commands.
export async function detectTasks(): Promise<Task[]> {
  const root = get().root;
  if (!root) return [];
  const names = new Set((await fs.readDir(root).catch(() => [])).map((e) => e.name));
  const tasks: Task[] = [];

  if (names.has("package.json")) {
    const text = await readText(join(root, "package.json"));
    try {
      const scripts = (text ? JSON.parse(text).scripts : null) ?? {};
      const pm = packageManager(names);
      for (const [name, body] of Object.entries(scripts)) {
        tasks.push({ label: name, command: `${pm} run ${quote(name)}`, detail: String(body), source: pm });
      }
    } catch {}
  }

  for (const file of ["deno.json", "deno.jsonc"]) {
    if (!names.has(file)) continue;
    const text = await readText(join(root, file));
    try {
      const config = text ? (parseJsonc(text) as { tasks?: Record<string, unknown> }) : null;
      for (const [name, body] of Object.entries(config?.tasks ?? {})) {
        const detail = typeof body === "string" ? body : String((body as { command?: string })?.command ?? "");
        tasks.push({ label: name, command: `deno task ${quote(name)}`, detail, source: "deno" });
      }
    } catch {}
  }

  if (names.has("Cargo.toml")) {
    for (const sub of ["build", "run", "test", "check", "clippy"]) {
      tasks.push({ label: `cargo ${sub}`, command: `cargo ${sub}`, detail: "Cargo.toml", source: "cargo" });
    }
  }

  if (names.has("go.mod")) {
    for (const [label, command] of [
      ["go run", "go run ."],
      ["go build", "go build ./..."],
      ["go test", "go test ./..."],
    ]) {
      tasks.push({ label, command, detail: "go.mod", source: "go" });
    }
  }

  const makefile = ["Makefile", "makefile", "GNUmakefile"].find((n) => names.has(n));
  if (makefile) {
    const text = await readText(join(root, makefile));
    for (const target of text ? makeTargets(text) : []) {
      tasks.push({ label: `make ${target}`, command: `make ${quote(target)}`, detail: makefile, source: "make" });
    }
  }

  return tasks;
}

let lastTask: Task | null = null;

export function runTask(task: Task) {
  lastTask = task;
  createTerminal({ title: task.label, command: task.command });
}

export function rerunTask() {
  if (lastTask) runTask(lastTask);
  else toast("No task has been run yet");
}

type Runner = (file: string, root: string | null) => string;

const tmpBinary = (file: string) => `"\${TMPDIR:-/tmp}/outline-run-${basename(file).replace(/\W/g, "_")}"`;
const compileAndRun = (compiler: string) => (file: string) => {
  const out = tmpBinary(file);
  return `${compiler} ${quote(file)} -o ${out} && ${out}`;
};

const runners: Record<string, Runner> = {
  js: (f) => `node ${quote(f)}`,
  mjs: (f) => `node ${quote(f)}`,
  cjs: (f) => `node ${quote(f)}`,
  ts: (f) => `npx tsx ${quote(f)}`,
  mts: (f) => `npx tsx ${quote(f)}`,
  py: (f) => `python3 ${quote(f)}`,
  rb: (f) => `ruby ${quote(f)}`,
  sh: (f) => `bash ${quote(f)}`,
  bash: (f) => `bash ${quote(f)}`,
  zsh: (f) => `zsh ${quote(f)}`,
  go: (f) => `go run ${quote(f)}`,
  swift: (f) => `swift ${quote(f)}`,
  php: (f) => `php ${quote(f)}`,
  pl: (f) => `perl ${quote(f)}`,
  lua: (f) => `lua ${quote(f)}`,
  java: (f) => `java ${quote(f)}`,
  c: compileAndRun("cc"),
  cpp: compileAndRun("c++ -std=c++20"),
  cc: compileAndRun("c++ -std=c++20"),
  rs: (f, root) => (root && f.startsWith(root + "/") ? "cargo run" : compileAndRun("rustc")(f)),
};

// Saves the active file and runs it in the terminal with the interpreter or
// compiler that matches its extension.
export async function runActiveFile() {
  const path = get().active;
  if (!path || isDiffPath(path) || !session.has(path)) return toast("Open a file to run it");
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  const runner = runners[ext];
  if (!runner) return toast(`Don't know how to run .${ext} files`);
  if (get().tabs.find((t) => t.path === path)?.dirty) await saveFile(path);
  const root = get().root;
  const hasCargo = ext === "rs" && root ? (await fs.readDir(root).catch(() => [])).some((e) => e.name === "Cargo.toml") : false;
  const command = runner(path, hasCargo ? root : null);
  sendToTerminal(`cd ${quote(root ?? dirname(path))} && ${command}\r`);
}

// Sends the selection (or the current line when nothing is selected) to the terminal.
export function runSelection() {
  const view = session.view;
  const path = get().active;
  if (!view || !path || isDiffPath(path)) return;
  const sel = view.state.selection.main;
  const text = sel.empty ? view.state.doc.lineAt(sel.head).text : view.state.sliceDoc(sel.from, sel.to);
  if (!text.trim()) return;
  sendToTerminal(text.replace(/\r?\n/g, "\r").replace(/\r?$/, "\r"));
}
