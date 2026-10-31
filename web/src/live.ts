import type { LiveConfig, LiveReq } from "./types";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`api/live${path}`, init);
  const body = await r.json();
  if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
  return body as T;
}

export const getConfig = () => call<LiveConfig>("");

export const sendLive = (route: string) =>
  call<LiveReq>("", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ route }) });

export const getLive = (id: string) => call<LiveReq>(`/${id}`);

// Seconds we keep waiting for the invocation log before showing "Unknown".
export const LOG_WAIT_S = 120;
