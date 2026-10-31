import { modeLabel, modelLabel, usd } from "./aggregate";
import { LOG_WAIT_S } from "./live";
import type { LiveConfig, LiveReq, Region } from "./types";

interface Props {
  config: LiveConfig;
  live: LiveReq[];
  sending: boolean;
  error: string | null;
  now: number;
  regions: Record<string, Region>;
  onSend: (route: string) => void;
}

function RegionCell({ r, now, regions }: { r: LiveReq; now: number; regions: Record<string, Region> }) {
  const name = (c: string) => `${regions[c]?.name ?? c} (${c})`;
  if (r.processing_region) {
    return (
      <>
        <b>{name(r.processing_region)}</b>{" "}
        <span className={`badge ${r.region_evidence}`}>{r.region_evidence}</span>
        <br />
        <small>
          {r.region_evidence === "direct"
            ? "Direct invocation: processed in the source region."
            : "From the Bedrock invocation log (inferenceRegion)."}
        </small>
      </>
    );
  }
  const waited = Math.round((now - Date.parse(r.timestamp)) / 1000);
  if (waited > LOG_WAIT_S) return <>Unknown <small>(invocation log not received yet)</small></>;
  return <span className="pending">Waiting for the invocation log… {waited}s</span>;
}

export default function LivePanel({ config, live, sending, error, now, regions, onSend }: Props) {
  return (
    <div>
      <h2>Try a live call</h2>
      <p className="muted">
        Sends one real Bedrock request with a fixed prompt: <i>“{config.prompt}”</i>. Pick where it is called from —
        then watch where it is actually processed.
      </p>
      <div className="routes">
        {config.routes.map((r) => (
          <button key={r.id} disabled={sending || config.remaining_today <= 0} onClick={() => onSend(r.id)}>
            {r.label}
          </button>
        ))}
      </div>
      <p className="muted">{config.remaining_today} live calls left today (site-wide limit).</p>
      {sending && <p className="pending">Calling Bedrock…</p>}
      {error && <p className="note">{error}</p>}

      {live.map((r) => (
        <div className="live-card" key={r.request_id}>
          <div className="live-title">{r.route_label}</div>
          <dl>
            <dt>Called from</dt><dd>{regions[r.source_region]?.name} ({r.source_region})</dd>
            <dt>Processed in</dt><dd><RegionCell r={r} now={now} regions={regions} /></dd>
            <dt>Model</dt><dd>{modelLabel(r.base_model)} · {modeLabel(r.inference_mode)}</dd>
            <dt>Tokens</dt><dd>{r.input_tokens} in / {r.output_tokens} out</dd>
            <dt>Duration</dt><dd>{r.client_latency_ms} ms <small>(measured by the API)</small></dd>
            <dt>Est. cost</dt><dd>{usd(r.estimated_cost_usd)} <small>({r.source_region} price)</small></dd>
            <dt>Answer</dt><dd><small>{r.answer}</small></dd>
            <dt>Request ID</dt><dd><code>{r.request_id}</code></dd>
          </dl>
        </div>
      ))}
    </div>
  );
}
