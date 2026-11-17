import { useEffect, useRef } from "react";
import { Marked } from "marked";
import DOMPurify from "dompurify";
import { invoke } from "@tauri-apps/api/core";
import { X } from "lucide-react";
import { session } from "../editor/session";
import { dirname, fs, join } from "../lib/fs";
import { imageMime } from "../lib/media";
import { highlightBlocks } from "../lib/highlight";
import { openFile, toggleMarkdownPreview } from "../actions";

const md = new Marked({ gfm: true, breaks: false });

function resolve(base: string, href: string) {
  const clean = decodeURIComponent(href.split("#")[0].split("?")[0]);
  if (clean.startsWith("/")) return clean;
  const parts = join(dirname(base), clean).split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else if (p !== "." && p !== "") out.push(p);
  }
  return "/" + out.join("/");
}

const isExternal = (href: string) => /^[a-z][a-z0-9+.-]*:/i.test(href);

async function loadImages(root: HTMLElement, base: string, urls: string[], alive: () => boolean) {
  for (const img of root.querySelectorAll<HTMLImageElement>("img[data-src]")) {
    const src = img.dataset.src!;
    try {
      const path = resolve(base, src);
      const bytes = await fs.readBytes(path);
      if (!alive()) return;
      const url = URL.createObjectURL(new Blob([bytes], { type: imageMime(path) }));
      urls.push(url);
      img.src = url;
    } catch {
      img.alt = img.alt || src;
      img.classList.add("broken");
    }
  }
}

export function MarkdownPreview({ path, pane }: { path: string; pane: 0 | 1 }) {
  const body = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer: number | undefined;
    let generation = 0;
    const urls: string[] = [];
    const render = () => {
      const el = body.current;
      if (!el) return;
      const text = session.content(path) ?? "";
      const gen = ++generation;
      const alive = () => gen === generation;
      const html = DOMPurify.sanitize(md.parse(text, { async: false }) as string, { ADD_ATTR: ["target"] });
      const tpl = document.createElement("template");
      tpl.innerHTML = html;
      const used = new Map<string, number>();
      for (const h of tpl.content.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
        const slug = (h.textContent ?? "")
          .trim()
          .toLowerCase()
          .replace(/[^\p{L}\p{N}\s-]/gu, "")
          .replace(/\s+/g, "-");
        const n = used.get(slug) ?? 0;
        used.set(slug, n + 1);
        h.id = n ? `${slug}-${n}` : slug;
      }
      for (const img of tpl.content.querySelectorAll("img")) {
        const src = img.getAttribute("src") ?? "";
        if (src && !isExternal(src) && !src.startsWith("data:")) {
          img.dataset.src = src;
          img.removeAttribute("src");
        }
      }
      el.replaceChildren(tpl.content);
      for (const u of urls.splice(0)) URL.revokeObjectURL(u);
      highlightBlocks(el, alive);
      loadImages(el, path, urls, alive);
    };
    render();
    const off = session.onChange((p) => {
      if (p !== path) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(render, 140);
    });
    return () => {
      off();
      window.clearTimeout(timer);
      generation++;
      for (const u of urls) URL.revokeObjectURL(u);
    };
  }, [path]);

  useEffect(() => {
    const view = pane === 1 ? session.secondary : session.primary;
    const source = view?.scrollDOM;
    const target = scroller.current;
    if (!source || !target) return;
    const onScroll = () => {
      const max = source.scrollHeight - source.clientHeight;
      const ratio = max > 0 ? source.scrollTop / max : 0;
      target.scrollTop = ratio * (target.scrollHeight - target.clientHeight);
    };
    source.addEventListener("scroll", onScroll, { passive: true });
    return () => source.removeEventListener("scroll", onScroll);
  }, [path, pane]);

  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    const href = a.getAttribute("href") ?? "";
    e.preventDefault();
    if (href.startsWith("#")) {
      const id = decodeURIComponent(href.slice(1));
      body.current?.querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    if (/^https?:/i.test(href)) {
      invoke("open_external", { url: href }).catch(() => {});
      return;
    }
    if (!isExternal(href)) openFile(resolve(path, href));
  };

  return (
    <div className="md-preview">
      <div className="md-preview-head">
        <span>Preview</span>
        <button className="icon-btn" title="Close Preview (⇧⌘V)" onClick={() => toggleMarkdownPreview(path)}>
          <X size={12} strokeWidth={2} />
        </button>
      </div>
      <div className="md-scroll" ref={scroller}>
        <article className="md-body" ref={body} onClick={onClick} />
      </div>
    </div>
  );
}
