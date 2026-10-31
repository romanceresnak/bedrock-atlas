import { useEffect, useMemo, useState } from "react";
import MapView, { type Metric } from "./MapView";
import Panel, { type Selection } from "./Panel";
import LivePanel from "./LivePanel";
import { aggregate, modeLabel, modelLabel } from "./aggregate";
import { LOG_WAIT_S, getConfig, getLive, sendLive } from "./live";
import type { LiveConfig, LiveReq, Meta, Region, Req } from "./types";

interface Data {
  reqs: Req[];
  regions: Record<string, Region>;
  meta: Meta;
}

const minute = (ts: string) => ts.slice(0, 16);
const area = (r: string) => r.split("-")[0];

function useData(): Data | null {
  const [data, setData] = useState<Data | null>(null);
  useEffect(() => {
    Promise.all(["requests", "regions", "meta"].map((f) => fetch(`data/${f}.json`).then((r) => r.json()))).then(
      ([reqs, regions, meta]) => setData({ reqs, regions, meta }),
    );
  }, []);
  return data;
}

// The single most striking observation: the largest cross-geography link.
function headline(reqs: Req[], regions: Record<string, Region>) {
  const counts = new Map<string, Req[]>();
  for (const r of reqs) {
    if (!r.processing_region || area(r.processing_region) === area(r.source_region)) continue;
    const k = `${r.source_region}>${r.processing_region}`;
    counts.set(k, [...(counts.get(k) ?? []), r]);
  }
  const top = [...counts.values()].sort((a, b) => b.length - a.length)[0];
  if (!top) return null;
  const r = top[0];
  const verified = top.filter((x) => x.region_evidence === "verified").length;
  return {
    title: `Called from ${regions[r.source_region].name}. Processed in ${regions[r.processing_region!].name}.`,
    sub: `${top.length} ${modelLabel(r.base_model)} requests via ${modeLabel(r.inference_mode)} · ${verified} verified by invocation logs + CloudTrail · billed at ${regions[r.source_region].name} prices`,
  };
}

function toggle(set: Set<string>, v: string) {
  const s = new Set(set);
  if (s.has(v)) s.delete(v);
  else s.add(v);
  return s;
}

export default function App() {
  const data = useData();
  const [teams, setTeams] = useState<Set<string>>(new Set());
  const [models, setModels] = useState<Set<string>>(new Set());
  const [metric, setMetric] = useState<Metric>("cost");
  const [t, setT] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [sel, setSel] = useState<Selection>({ kind: "overview" });
  const [liveConfig, setLiveConfig] = useState<LiveConfig | null>(null);
  const [live, setLive] = useState<LiveReq[]>([]);
  const [sending, setSending] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  // Live demo is optional: without the API (e.g. local dev) the button is hidden.
  useEffect(() => {
    getConfig().then(setLiveConfig).catch(() => setLiveConfig(null));
  }, []);

  // Poll pending live requests until the invocation log brings the processing region.
  const pending = live.filter((r) => !r.processing_region && now - Date.parse(r.timestamp) < LOG_WAIT_S * 1000);
  useEffect(() => {
    if (!pending.length) return;
    const id = setTimeout(async () => {
      const fresh = await Promise.all(pending.map((r) => getLive(r.request_id).catch(() => r)));
      setLive((prev) => prev.map((r) => fresh.find((f) => f.request_id === r.request_id) ?? r));
      setNow(Date.now());
    }, 2000);
    return () => clearTimeout(id);
  }, [pending.length, now]);

  async function onSend(route: string) {
    setSending(true);
    setLiveError(null);
    try {
      const r = await sendLive(route);
      setLive((prev) => [r, ...prev]);
      setNow(Date.now());
      setLiveConfig((c) => (c ? { ...c, remaining_today: c.remaining_today - 1 } : c));
    } catch (e) {
      setLiveError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  const minutes = useMemo(() => (data ? [...new Set(data.reqs.map((r) => minute(r.timestamp)))].sort() : []), [data]);
  const ti = t ?? minutes.length - 1;

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setT((prev) => {
        const next = (prev ?? -1) + 1;
        if (next >= minutes.length - 1) setPlaying(false);
        return Math.min(next, minutes.length - 1);
      });
    }, 500);
    return () => clearInterval(id);
  }, [playing, minutes.length]);

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.reqs.filter(
      (r) =>
        (teams.size === 0 || teams.has(r.team)) &&
        (models.size === 0 || models.has(r.base_model)) &&
        minute(r.timestamp) <= minutes[ti],
    );
  }, [data, teams, models, ti, minutes]);

  const agg = useMemo(() => aggregate(filtered), [filtered]);
  const head = useMemo(() => (data ? headline(data.reqs, data.regions) : null), [data]);
  const dataRegions = useMemo(
    () => (data ? [...new Set(data.reqs.flatMap((r) => [r.source_region, r.processing_region ?? r.source_region]))] : []),
    [data],
  );
  const labels = useMemo(
    () => [...new Set([...dataRegions, ...live.flatMap((r) => [r.source_region, r.processing_region ?? r.source_region])])].sort(),
    [dataRegions, live],
  );

  if (!data) return <div className="loading">Loading Bedrock Atlas…</div>;

  return (
    <div className="app">
      <MapView
        regions={data.regions}
        agg={agg}
        metric={metric}
        selectedLink={sel.kind === "link" ? sel.key : null}
        live={live}
        labels={labels}
        focus={dataRegions}
        onSelectLink={(key) => setSel({ kind: "link", key })}
        onSelectRegion={(region) => setSel({ kind: "region", region })}
      />

      <header className="hero">
        <div className="brand">Bedrock Atlas</div>
        {head && <h1>{head.title}</h1>}
        {head && <p>{head.sub}</p>}
        {!import.meta.env.VITE_LOCATION_API_KEY && <p className="warn">Basemap disabled: set VITE_LOCATION_API_KEY.</p>}
        {liveConfig && (
          <button className="cta" onClick={() => setSel({ kind: "live" })}>⚡ Try a live call</button>
        )}
      </header>

      <aside className="panel">
        <div className="filters">
          <div className="group">
            {data.meta.teams.map((x) => (
              <button key={x} className={teams.has(x) ? "on" : ""} onClick={() => setTeams(toggle(teams, x))}>{x}</button>
            ))}
          </div>
          <div className="group">
            {data.meta.models.map((x) => (
              <button key={x} className={models.has(x) ? "on" : ""} onClick={() => setModels(toggle(models, x))}>{modelLabel(x)}</button>
            ))}
          </div>
          <div className="group">
            <span className="muted">Color:</span>
            <button className={metric === "cost" ? "on" : ""} onClick={() => setMetric("cost")}>Est. cost</button>
            <button className={metric === "latency" ? "on" : ""} onClick={() => setMetric("latency")}>Avg latency</button>
          </div>
        </div>
        {sel.kind === "live" && liveConfig ? (
          <>
            <button className="back" onClick={() => setSel({ kind: "overview" })}>← Back to dataset</button>
            <LivePanel config={liveConfig} live={live} sending={sending} error={liveError} now={now} regions={data.regions} onSend={onSend} />
          </>
        ) : (
          <Panel sel={sel} setSel={setSel} reqs={filtered} agg={agg} regions={data.regions} meta={data.meta} />
        )}
      </aside>

      <footer className="timeline">
        <button onClick={() => { if (ti >= minutes.length - 1) setT(0); setPlaying(!playing); }}>
          {playing ? "❚❚" : "▶"}
        </button>
        <input type="range" min={0} max={minutes.length - 1} value={ti} onChange={(e) => { setPlaying(false); setT(+e.target.value); }} />
        <span>up to {minutes[ti]?.replace("T", " ")} UTC</span>
      </footer>
    </div>
  );
}
