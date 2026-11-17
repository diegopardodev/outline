import { invoke } from "@tauri-apps/api/core";

function describe(value: unknown): string {
  if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

let recent = 0;
let windowStart = 0;

export function logLine(level: string, args: unknown[]) {
  const now = Date.now();
  if (now - windowStart > 1000) {
    windowStart = now;
    recent = 0;
  }
  if (++recent > 40) return;
  const msg = args.map(describe).join(" ").slice(0, 8000);
  invoke("log_line", { level, msg }).catch(() => {});
}
