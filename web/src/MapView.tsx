import { useEffect, useRef } from "react";
import maplibregl, { type GeoJSONSource, type StyleSpecification } from "maplibre-gl";
import type { Aggregates } from "./aggregate";
import type { LiveReq, Region } from "./types";

export type Metric = "cost" | "latency";

interface Props {
  regions: Record<string, Region>;
  agg: Aggregates;
  metric: Metric;
  selectedLink: string | null;
  live: LiveReq[];
  labels: string[]; // regions to label on the map
  focus: string[]; // regions to fit on first load
  onSelectLink: (key: string) => void;
  onSelectRegion: (region: string) => void;
}

const KEY = import.meta.env.VITE_LOCATION_API_KEY as string | undefined;
const MAP_REGION = "eu-central-1";

const STYLE: string | StyleSpecification = KEY
  ? `https://maps.geo.${MAP_REGION}.amazonaws.com/v2/styles/Monochrome/descriptor?key=${KEY}&color-scheme=Light`
  : { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#e5e7eb" } }] };

// Curved line between two approximate region points (logical relationship, not a network path).
function arc(a: Region, b: Region): [number, number][] {
  const [x1, y1, x2, y2] = [a.lon, a.lat, b.lon, b.lat];
  // Bow every arc northward, like a great-circle route on this projection.
  const [cx, cy] = [(x1 + x2) / 2, (y1 + y2) / 2 + Math.hypot(x2 - x1, y2 - y1) * 0.2];
  return Array.from({ length: 33 }, (_, i) => {
    const t = i / 32;
    return [
      (1 - t) ** 2 * x1 + 2 * (1 - t) * t * cx + t ** 2 * x2,
      (1 - t) ** 2 * y1 + 2 * (1 - t) * t * cy + t ** 2 * y2,
    ];
  });
}

const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features });

function toGeoJSON(regions: Record<string, Region>, agg: Aggregates, metric: Metric) {
  const point = (r: string) => ({ type: "Point" as const, coordinates: [regions[r].lon, regions[r].lat] });
  const srcs = [...agg.sources.values()];
  const values = srcs.map((s) => (metric === "cost" ? s.cost : s.latencyN ? s.latencySum / s.latencyN : 0));
  const max = Math.max(...values, 1e-12);

  return {
    sources: fc(
      srcs.map((s, i) => ({
        type: "Feature",
        geometry: point(s.region),
        properties: { region: s.region, size: Math.sqrt(s.cost), metric: values[i] / max },
      })),
    ),
    processing: fc(
      [...agg.processing].map(([r, n]) => ({
        type: "Feature",
        geometry: point(r),
        properties: { region: r, requests: n },
      })),
    ),
    links: fc(
      [...agg.links.values()].filter((l) => l.source !== l.target).map((l) => ({
        type: "Feature",
        geometry: { type: "LineString", coordinates: arc(regions[l.source], regions[l.target]) },
        properties: {
          key: l.key,
          requests: l.requests,
          state: l.verified === 0 && l.observed > 0 ? "observed" : "verified",
        },
      })),
    ),
  };
}

function fit(m: maplibregl.Map, lons: number[], lats: number[]) {
  m.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], {
    padding: window.innerWidth < 900
      ? { top: 130, bottom: window.innerHeight * 0.42 + 70, left: 30, right: 30 }
      : { top: 190, bottom: 110, left: 70, right: 440 },
    maxZoom: 4,
  });
}

function liveGeoJSON(regions: Record<string, Region>, live: LiveReq[]) {
  const lines: GeoJSON.Feature[] = [];
  const points: GeoJSON.Feature[] = [];
  for (const r of live) {
    const target = r.processing_region;
    if (target && target !== r.source_region && regions[target]) {
      lines.push({ type: "Feature", geometry: { type: "LineString", coordinates: arc(regions[r.source_region], regions[target]) }, properties: {} });
    }
    const at = regions[target ?? r.source_region];
    if (at) points.push({ type: "Feature", geometry: { type: "Point", coordinates: [at.lon, at.lat] }, properties: { pending: !target } });
  }
  return { lines: fc(lines), points: fc(points) };
}

export default function MapView({ regions, agg, metric, selectedLink, live, labels, focus, onSelectLink, onSelectRegion }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const loaded = useRef(false);
  const markers = useRef<maplibregl.Marker[]>([]);
  const lastFit = useRef<string | null>(null);
  const handlers = useRef({ onSelectLink, onSelectRegion });
  handlers.current = { onSelectLink, onSelectRegion };

  useEffect(() => {
    const m = new maplibregl.Map({
      container: container.current!,
      style: STYLE,
      center: [-35, 47],
      zoom: 2,
      attributionControl: { compact: true },
    });
    map.current = m;

    m.on("load", () => {
      const empty = fc([]);
      m.addSource("links", { type: "geojson", data: empty });
      m.addSource("sources", { type: "geojson", data: empty });
      m.addSource("processing", { type: "geojson", data: empty });
      m.addSource("live-lines", { type: "geojson", data: empty });
      m.addSource("live-points", { type: "geojson", data: empty });

      const width: maplibregl.ExpressionSpecification = ["interpolate", ["linear"], ["get", "requests"], 1, 1.5, 60, 9];
      m.addLayer({
        id: "links-verified", type: "line", source: "links", filter: ["==", ["get", "state"], "verified"],
        layout: { "line-cap": "round" },
        paint: { "line-color": "#0369a1", "line-width": width, "line-opacity": 0.85 },
      });
      m.addLayer({
        id: "links-observed", type: "line", source: "links", filter: ["==", ["get", "state"], "observed"],
        paint: { "line-color": "#d97706", "line-width": width, "line-dasharray": [2, 1.5] },
      });
      m.addLayer({
        id: "links-selected", type: "line", source: "links", filter: ["==", ["get", "key"], ""],
        paint: { "line-color": "#0f172a", "line-width": ["+", width, 3], "line-opacity": 0.3 },
      });
      m.addLayer({
        id: "processing", type: "circle", source: "processing",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["sqrt", ["get", "requests"]], 1, 6, 12, 26],
          "circle-color": "rgba(255,255,255,0.55)",
          "circle-stroke-color": "#0369a1",
          "circle-stroke-width": 1.5,
        },
      });
      m.addLayer({
        id: "sources", type: "circle", source: "sources",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["get", "size"], 0, 7, 0.35, 34],
          "circle-color": ["interpolate", ["linear"], ["get", "metric"], 0, "#fde68a", 0.5, "#f97316", 1, "#dc2626"],
          "circle-opacity": 0.9,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.5,
        },
      });

      m.addLayer({
        id: "live-lines", type: "line", source: "live-lines",
        layout: { "line-cap": "round" },
        paint: { "line-color": "#16a34a", "line-width": 4, "line-dasharray": [1, 1.5] },
      });
      m.addLayer({
        id: "live-points", type: "circle", source: "live-points",
        paint: {
          "circle-radius": 14,
          "circle-color": "rgba(22,163,74,0.15)",
          "circle-stroke-color": "#16a34a",
          "circle-stroke-width": ["case", ["get", "pending"], 1.5, 3],
        },
      });

      for (const id of ["links-verified", "links-observed"]) {
        m.on("click", id, (e) => handlers.current.onSelectLink(e.features![0].properties.key));
        m.on("mouseenter", id, () => (m.getCanvas().style.cursor = "pointer"));
        m.on("mouseleave", id, () => (m.getCanvas().style.cursor = ""));
      }
      for (const id of ["sources", "processing"]) {
        m.on("click", id, (e) => handlers.current.onSelectRegion(e.features![0].properties.region));
        m.on("mouseenter", id, () => (m.getCanvas().style.cursor = "pointer"));
        m.on("mouseleave", id, () => (m.getCanvas().style.cursor = ""));
      }

      const lons = focus.map((r) => regions[r].lon);
      const lats = focus.map((r) => regions[r].lat);
      fit(m, lons, lats);
      loaded.current = true;
      m.fire("atlas:ready");
    });
    return () => m.remove();
  }, [regions]);

  const labelKey = labels.join(",");
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    markers.current.forEach((mk) => mk.remove());
    markers.current = labels.filter((c) => regions[c]).map((code) => {
      const el = document.createElement("div");
      el.className = "region-label";
      el.innerHTML = `<b>${regions[code].name}</b><span>${code}</span>`;
      el.onclick = () => handlers.current.onSelectRegion(code);
      return new maplibregl.Marker({ element: el, anchor: "top", offset: [0, 14] })
        .setLngLat([regions[code].lon, regions[code].lat])
        .addTo(m);
    });
  }, [regions, labelKey]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const update = () => {
      const g = toGeoJSON(regions, agg, metric);
      (m.getSource("links") as GeoJSONSource).setData(g.links);
      (m.getSource("sources") as GeoJSONSource).setData(g.sources);
      (m.getSource("processing") as GeoJSONSource).setData(g.processing);
      m.setFilter("links-selected", ["==", ["get", "key"], selectedLink ?? ""]);
      const l = liveGeoJSON(regions, live);
      (m.getSource("live-lines") as GeoJSONSource).setData(l.lines);
      (m.getSource("live-points") as GeoJSONSource).setData(l.points);

      // Bring the newest resolved live request into view (it may land outside the dataset's regions).
      const newest = live.find((r) => r.processing_region && regions[r.processing_region]);
      if (newest && newest.request_id !== lastFit.current) {
        lastFit.current = newest.request_id;
        const pts = [regions[newest.source_region], regions[newest.processing_region!]];
        fit(m, pts.map((p) => p.lon), pts.map((p) => p.lat));
      }
    };
    if (loaded.current) update();
    else m.once("atlas:ready", update);
  }, [regions, agg, metric, selectedLink, live]);

  return <div ref={container} className="map" />;
}
