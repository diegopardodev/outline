import { useEffect } from "react";
import { useStore } from "./store";
import { Sidebar } from "./components/Sidebar";
import { Toolbar } from "./components/Toolbar";
import { Tabs } from "./components/Tabs";
import { Breadcrumbs } from "./components/Breadcrumbs";
import { EditorPane } from "./components/EditorPane";
import { TerminalPanel } from "./components/TerminalPanel";
import { Palette } from "./components/Palette";
import { StatusBar } from "./components/StatusBar";
import { DialogHost, MenuHost, Toast } from "./components/Overlays";
import { installShortcuts } from "./commands";
import { boot } from "./actions";
import { fontStack } from "./lib/fonts";
import { applyColorTheme } from "./editor/themes";
import { applyTerminalTheme } from "./terminal/manager";

let booted = false;

export function App() {
  const sidebar = useStore((s) => s.sidebarVisible);
  const fontSize = useStore((s) => s.fontSize);
  const font = useStore((s) => s.editorFont);
  const glass = useStore((s) => s.glass);
  const terminalOpen = useStore((s) => s.terminalOpen);
  const colorTheme = useStore((s) => s.colorTheme);

  const dark = useStore((s) => s.dark);

  useEffect(() => applyColorTheme(colorTheme), [colorTheme, dark]);
  useEffect(() => applyTerminalTheme(dark), [dark]);

  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty("--editor-font-size", `${fontSize}px`);
    root.setProperty("--font-mono", fontStack(font));
    root.setProperty("--glass", String(glass));
  }, [fontSize, font, glass]);

  useEffect(() => {
    const off = installShortcuts();
    if (!booted) {
      booted = true;
      boot();
    }
    return off;
  }, []);

  return (
    <div className={`app${sidebar ? "" : " no-sidebar"}`}>
      {sidebar && <Sidebar />}
      <main className="main">
        <Toolbar />
        <Tabs />
        <Breadcrumbs />
        <div className="workspace">
          <EditorPane />
          {terminalOpen && <TerminalPanel />}
        </div>
        <StatusBar />
      </main>
      <Palette />
      <DialogHost />
      <MenuHost />
      <Toast />
    </div>
  );
}
