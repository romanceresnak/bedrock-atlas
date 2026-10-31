import type { Req } from "./types";

export interface SourceAgg {
  region: string;
  cost: number;
  requests: number;
  unpriced: number;
  latencySum: number;
  latencyN: number;
}

export interface LinkAgg {
  key: string;
  source: string;
  target: string;
  requests: number;
  cost: number;
  verified: number;
  observed: number;
}

export interface Aggregates {
  sources: Map<string, SourceAgg>;
  processing: Map<string, number>;
  links: Map<string, LinkAgg>;
  direct: Map<string, number>;
  unknown: number;
}

export const linkKey = (s: string, t: string) => `${s}>${t}`;

export function aggregate(reqs: Req[]): Aggregates {
  const sources = new Map<string, SourceAgg>();
  const processing = new Map<string, number>();
  const links = new Map<string, LinkAgg>();
  const direct = new Map<string, number>();
  let unknown = 0;

  for (const r of reqs) {
    const s = sources.get(r.source_region) ?? {
      region: r.source_region, cost: 0, requests: 0, unpriced: 0, latencySum: 0, latencyN: 0,
    };
    s.requests += 1;
    if (r.estimated_cost_usd === null) s.unpriced += 1;
    else s.cost += r.estimated_cost_usd;
    if (r.client_latency_ms !== null) {
      s.latencySum += r.client_latency_ms;
      s.latencyN += 1;
    }
    sources.set(r.source_region, s);

    const p = r.processing_region;
    if (!p) {
      unknown += 1;
      continue;
    }
    processing.set(p, (processing.get(p) ?? 0) + 1);
    if (r.region_evidence === "direct") {
      direct.set(p, (direct.get(p) ?? 0) + 1);
      continue;
    }
    const key = linkKey(r.source_region, p);
    const l = links.get(key) ?? {
      key, source: r.source_region, target: p, requests: 0, cost: 0, verified: 0, observed: 0,
    };
    l.requests += 1;
    l.cost += r.estimated_cost_usd ?? 0;
    if (r.region_evidence === "verified") l.verified += 1;
    if (r.region_evidence === "observed") l.observed += 1;
    links.set(key, l);
  }
  return { sources, processing, links, direct, unknown };
}

export function usd(v: number | null | undefined): string {
  if (v === null || v === undefined) return "Unpriced";
  if (v === 0) return "$0";
  if (v < 0.01) return `$${v.toFixed(5)}`;
  return `$${v.toFixed(4)}`;
}

export const orUnknown = (v: unknown) => (v === null || v === undefined || v === "" ? "Unknown" : String(v));

export const modelLabel = (id: string) =>
  id.includes("haiku-4-5") ? "Claude Haiku 4.5" : id.includes("nova-lite") ? "Nova Lite" : id;

export const modeLabel = (m: string) =>
  m === "global" ? "global profile" : m === "geo" ? "geo profile" : "direct (in-region)";
