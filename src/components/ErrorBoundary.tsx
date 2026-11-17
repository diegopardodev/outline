import { Component, type ErrorInfo, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { logLine } from "../lib/log";

type State = { error: Error | null };

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logLine("crash", [error, info.componentStack ?? ""]);
  }

  revealLog = async () => {
    try {
      const path = await invoke<string>("log_path");
      await invoke("reveal_in_finder", { path });
    } catch {}
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="crash" data-tauri-drag-region>
        <div className="crash-card">
          <div className="crash-title">Outline ran into a problem</div>
          <div className="crash-detail">{error.message || String(error)}</div>
          <div className="crash-actions">
            <button className="btn plain" onClick={this.revealLog}>
              Show Log
            </button>
            <button className="btn primary" onClick={() => window.location.reload()}>
              Reload Window
            </button>
          </div>
        </div>
      </div>
    );
  }
}
