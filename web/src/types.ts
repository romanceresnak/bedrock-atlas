export type Evidence = "verified" | "observed" | "direct" | "unknown" | "conflict";

export interface Req {
  identity: string;
  request_id: string;
  timestamp: string;
  operation: string;
  source_region: string;
  model_id: string;
  base_model: string;
  inference_mode: "in_region" | "geo" | "global";
  processing_region: string | null;
  region_evidence: Evidence;
  region_sources: string[];
  team: string;
  principal_type: string;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number | null;
  cost_status: "priced" | "unpriced";
  price_effective_date: string | null;
  client_latency_ms: number | null;
  service_latency_ms: number | null;
  workload: string | null;
  phase: string | null;
  item_id: string | null;
  score: number | null;
}

export interface Region {
  name: string;
  lon: number;
  lat: number;
}

export interface Meta {
  generated_at: string;
  collection_start: string;
  collection_end: string;
  records: number;
  source_regions: string[];
  processing_regions: string[];
  teams: string[];
  models: string[];
  region_evidence: Record<string, number>;
  cost_status: Record<string, number>;
  price_effective_dates: string[];
  cost_label: string;
  limitations: string[];
}

export interface LiveRoute {
  id: string;
  label: string;
  source_region: string;
}

export interface LiveConfig {
  prompt: string;
  remaining_today: number;
  routes: LiveRoute[];
}

export interface LiveReq {
  request_id: string;
  route_label: string;
  timestamp: string;
  source_region: string;
  model_id: string;
  base_model: string;
  inference_mode: "in_region" | "geo" | "global";
  processing_region?: string;
  region_evidence?: "observed" | "direct";
  input_tokens: number;
  output_tokens: number;
  client_latency_ms: number;
  estimated_cost_usd: number | null;
  price_effective_date: string | null;
  answer: string;
  log_received_at?: string;
}
