import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { logLine } from "./lib/log";

if ("__TAURI_INTERNALS__" in window) {
  for (const kind of ["error", "warn"] as const) {
    const orig = console[kind];
    console[kind] = (...args: unknown[]) => {
      logLine(kind, args);
      orig(...args);
    };
  }
  window.addEventListener("error", (e) => logLine("uncaught", [e.error ?? e.message]));
  window.addEventListener("unhandledrejection", (e) => logLine("rejection", [e.reason]));
  document.documentElement.classList.add("tauri");
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
