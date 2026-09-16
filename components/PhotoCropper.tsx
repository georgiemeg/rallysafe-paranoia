"use client";

import { useEffect, useRef, useState } from "react";

const VIEW = 280;
const OUT = 1024;

export function PhotoCropper({
  file,
  onCancel,
  onConfirm,
  busy,
}: {
  file: File;
  onCancel: () => void;
  onConfirm: (dataUrl: string) => void;
  busy?: boolean;
}) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const [src, setSrc] = useState("");
  const [nw, setNw] = useState(0);
  const [nh, setNh] = useState(0);
  const [x, setX] = useState(0);
  const [y, setY] = useState(0);
  const [scale, setScale] = useState(1);
  const [minScale, setMinScale] = useState(1);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const clamp = (nx: number, ny: number, sc: number) => {
    const maxX = 0;
    const maxY = 0;
    const minX = VIEW - nw * sc;
    const minY = VIEW - nh * sc;
    return {
      x: Math.min(maxX, Math.max(minX, nx)),
      y: Math.min(maxY, Math.max(minY, ny)),
    };
  };

  const onImg = (img: HTMLImageElement) => {
    imgRef.current = img;
    const ms = Math.max(VIEW / img.naturalWidth, VIEW / img.naturalHeight);
    setNw(img.naturalWidth);
    setNh(img.naturalHeight);
    setMinScale(ms);
    setScale(ms);
    setX((VIEW - img.naturalWidth * ms) / 2);
    setY((VIEW - img.naturalHeight * ms) / 2);
  };

  const zoomTo = (next: number) => {
    const sc = Math.min(minScale * 4, Math.max(minScale, next));
    const cx = VIEW / 2;
    const cy = VIEW / 2;
    const ratio = sc / scale;
    const nx = cx - (cx - x) * ratio;
    const ny = cy - (cy - y) * ratio;
    const c = clamp(nx, ny, sc);
    setScale(sc);
    setX(c.x);
    setY(c.y);
  };

  const exportCrop = () => {
    const img = imgRef.current;
    if (!img) return;
    const canvas = document.createElement("canvas");
    canvas.width = OUT;
    canvas.height = OUT;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, -x / scale, -y / scale, VIEW / scale, VIEW / scale, 0, 0, OUT, OUT);
    onConfirm(canvas.toDataURL("image/jpeg", 0.92));
  };

  return (
    <div className="fixed inset-0 z-[90] bg-black/80 flex items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#11151c] p-4 space-y-4">
        <div className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">Fit photo</div>
        <p className="text-sm text-neutral-400">Drag to move. Use the slider or scroll to zoom.</p>
        <div className="mx-auto w-fit p-1 bg-brand-gold rounded-sm shadow-[6px_6px_0_#960200]">
        <div
          className="relative overflow-hidden bg-black touch-none cursor-grab active:cursor-grabbing"
          style={{ width: VIEW, height: VIEW }}
          onPointerDown={(e) => {
            (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
            drag.current = { x, y, px: e.clientX, py: e.clientY };
          }}
          onPointerMove={(e) => {
            if (!drag.current) return;
            const nx = drag.current.x + (e.clientX - drag.current.px);
            const ny = drag.current.y + (e.clientY - drag.current.py);
            const c = clamp(nx, ny, scale);
            setX(c.x);
            setY(c.y);
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
          onWheel={(e) => {
            e.preventDefault();
            zoomTo(scale * (e.deltaY < 0 ? 1.08 : 0.92));
          }}
        >
          {src && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt=""
              draggable={false}
              onLoad={(e) => onImg(e.currentTarget)}
              className="absolute max-w-none select-none pointer-events-none"
              style={{
                width: nw ? nw * scale : "auto",
                height: nh ? nh * scale : "auto",
                left: x,
                top: y,
              }}
            />
          )}
        </div>
        </div>
        <label className="block">
          <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">Zoom</span>
          <input
            type="range"
            min={minScale}
            max={minScale * 4}
            step={0.01}
            value={scale}
            onChange={(e) => zoomTo(Number(e.target.value))}
            className="w-full mt-1 accent-[#d4a017]"
          />
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="flex-1 rounded-full py-3 font-mono uppercase tracking-widest text-sm text-neutral-300 border border-white/10"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || !nw}
            onClick={exportCrop}
            className="flex-1 rounded-full py-3 font-mono uppercase tracking-widest text-sm font-bold bg-brand-gold text-brand-ink disabled:opacity-50"
          >
            {busy ? "Saving…" : "Use this"}
          </button>
        </div>
      </div>
    </div>
  );
}
