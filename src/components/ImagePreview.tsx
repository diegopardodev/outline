import { useEffect, useRef, useState } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";
import { set, useStore } from "../store";
import { errorText, fs } from "../lib/fs";
import { imageMime, isSvg } from "../lib/media";
import { session } from "../editor/session";

const steps = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16];

export function ImagePreview({ path }: { path: string }) {
  const rev = useStore((s) => s.mediaRev[path] ?? 0);
  const stage = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState<number | "fit">("fit");

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setError(null);
    const load = async () => {
      const text = isSvg(path) && session.has(path) ? session.content(path) : null;
      const blob =
        text !== null
          ? new Blob([text], { type: "image/svg+xml" })
          : new Blob([await fs.readBytes(path)], { type: imageMime(path) });
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
      set({ media: { path, width: 0, height: 0, bytes: blob.size } });
    };
    load().catch((e) => !cancelled && setError(errorText(e)));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path, rev]);

  useEffect(() => {
    setZoom("fit");
    setNatural(null);
  }, [path]);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pad = 48;
  const fitScale = natural
    ? Math.min(1, (box.w - pad * 2) / natural.w, (box.h - pad * 2) / natural.h)
    : 1;
  const scale = zoom === "fit" ? Math.max(fitScale, 0.01) : zoom;
  const width = natural ? Math.max(1, Math.round(natural.w * scale)) : undefined;
  const height = natural ? Math.max(1, Math.round(natural.h * scale)) : undefined;

  const stepZoom = (dir: 1 | -1) => {
    const next = dir > 0 ? steps.find((s) => s > scale + 0.001) : [...steps].reverse().find((s) => s < scale - 0.001);
    setZoom(next ?? scale);
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setZoom(Math.min(16, Math.max(0.05, scale * Math.exp(-e.deltaY * 0.01))));
  };

  return (
    <div className="image-preview">
      <div ref={stage} className="image-stage" onWheel={onWheel}>
        {error ? (
          <div className="image-error">
            <div className="image-error-title">Can't preview this image</div>
            <div className="image-error-detail">{error}</div>
          </div>
        ) : (
          url && (
            <div className="image-canvas" style={{ width, height }}>
              <img
                src={url}
                alt=""
                draggable={false}
                className={scale > 1 && !isSvg(path) ? "pixelated" : undefined}
                style={{ width, height, visibility: natural ? "visible" : "hidden" }}
                onLoad={(e) => {
                  const img = e.currentTarget;
                  const w = img.naturalWidth || 300;
                  const h = img.naturalHeight || 150;
                  setNatural({ w, h });
                  set((s) => ({ media: { path, width: w, height: h, bytes: s.media?.path === path ? s.media.bytes : 0 } }));
                }}
                onError={() => setError("The image data couldn't be decoded.")}
                onDoubleClick={() => setZoom(zoom === "fit" ? 1 : "fit")}
              />
            </div>
          )
        )}
      </div>
      {!error && natural && (
        <div className="image-zoom">
          <button onClick={() => stepZoom(-1)} title="Zoom Out">
            <Minus size={14} />
          </button>
          <button className="image-zoom-level" onClick={() => setZoom(zoom === "fit" ? 1 : "fit")} title="Toggle Fit / Actual Size">
            {Math.round(scale * 100)}%
          </button>
          <button onClick={() => stepZoom(1)} title="Zoom In">
            <Plus size={14} />
          </button>
          <span className="image-zoom-sep" />
          <button className={zoom === "fit" ? "on" : undefined} onClick={() => setZoom("fit")} title="Fit to Window">
            <Maximize2 size={13} />
          </button>
        </div>
      )}
    </div>
  );
}
