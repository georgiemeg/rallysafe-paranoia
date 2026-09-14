"use client";

import { useEffect, useRef } from "react";

export type MapPos = {
  entryId: number;
  identifier: string;
  lat: number;
  lon: number;
  speed: number;
  status: number;
};

/** First-party OSM map with car pins (Leaflet + OSM tiles). */
export function LiveMap({ positions, className = "" }: { positions: MapPos[]; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!document.getElementById("leaflet-css")) {
      const link = document.createElement("link");
      link.id = "leaflet-css";
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    let map: { remove: () => void } | null = null;

    (async () => {
      const mod = await import("leaflet");
      const L = (mod as { default?: typeof import("leaflet") }).default ?? (mod as typeof import("leaflet"));
      if (cancelled || !ref.current) return;

      const pts = positions.filter((p) => p.lat && p.lon);
      const center: [number, number] = pts.length ? [pts[0].lat, pts[0].lon] : [47.5, -92.5];
      const m = L.map(ref.current, { zoomControl: true }).setView(center, 10);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap",
        maxZoom: 18,
      }).addTo(m);

      const layer = L.featureGroup();
      for (const p of pts) {
        const onStage = p.status === 1;
        L.circleMarker([p.lat, p.lon], {
          radius: 7,
          color: onStage ? "#f34213" : "#d5a021",
          fillColor: onStage ? "#f34213" : "#d5a021",
          fillOpacity: 0.9,
          weight: 2,
        })
          .bindPopup(`#${p.identifier} · ${p.speed} · ${onStage ? "on stage" : "transit"}`)
          .addTo(layer);
      }
      layer.addTo(m);
      if (pts.length > 1) {
        try {
          m.fitBounds(layer.getBounds().pad(0.2));
        } catch {
          /* empty bounds */
        }
      }
      map = m;
    })();

    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [positions]);

  return (
    <div
      ref={ref}
      className={`w-full h-[42vh] min-h-[240px] rounded-xl border border-white/10 bg-[#11151c] ${className}`}
    />
  );
}
