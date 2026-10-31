import type { Aggregates } from "./aggregate";
import { linkKey, modeLabel, modelLabel, orUnknown, usd } from "./aggregate";
import type { Meta, Region, Req } from "./types";

export type Selection =
  | { kind: "overview" }
  | { kind: "live" }
  | { kind: "region"; region: string }
  | { kind: "link"; key: string }
  | { kind: "request"; id: string; back: Selection };

interface Props {
  sel: Selection;
  setSel: (s: Selection) => void;
  reqs: Req[];
  agg: Aggregates;
  regions: Record<string, Region>;
  meta: Meta;
}

const EVIDENCE_TEXT: Record<string, string> = {
  verified: "Verified — invocation log and CloudTrail agree",
  observed: "Observed — one source so far",
  direct: "Direct invocation (same region)",
  unknown: "Unknown",
  conflict: "Unknown — sources disagree",
};

const sum = (rs: Req[]) => rs.reduce((a, r) => a + (r.estimated_cost_usd ?? 0), 0);

function groupBy(rs: Req[], key: (r: Req) => string) {
  const m = new Map<string, Req[]>();
  for (const r of rs) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
  return [...m].sort((a, b) => sum(b[1]) - sum(a[1]));
}

function Table({ rows }: { rows: [string, Req[]][] }) {
  return (
    <table>
      <tbody>
        {rows.map(([k, rs]) => (
          <tr key={k}>
            <td>{k}</td>
            <td className="num">{rs.length} req</td>
            <td className="num">{usd(sum(rs))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Badge({ e }: { e: string }) {
  return <span className={`badge ${e}`}>{e}</span>;
}

export default function Panel({ sel, setSel, reqs, agg, regions, meta }: Props) {
  const name = (r: string | null) => (r ? `${regions[r]?.name ?? r} (${r})` : "Unknown");

  if (sel.kind === "request") {
    const r = reqs.find((x) => x.request_id === sel.id);
    if (!r) return <Back onClick={() => setSel(sel.back)} />;
    return (
      <div>
        <Back onClick={() => setSel(sel.back)} />
        <h2>Follow the request</h2>
        <dl>
          <dt>Identity</dt><dd>{r.identity} <small>({r.principal_type}, anonymized)</small></dd>
          <dt>Team</dt><dd>{r.team} <small>(managed role mapping)</small></dd>
          <dt>Route</dt><dd>{name(r.source_region)} → {name(r.processing_region)}</dd>
          <dt>Processing region</dt><dd><Badge e={r.region_evidence} /> {EVIDENCE_TEXT[r.region_evidence]}</dd>
          <dt>Evidence sources</dt><dd>{r.region_sources.length ? r.region_sources.join(" + ") : "None (direct call)"}</dd>
          <dt>Model</dt><dd>{modelLabel(r.base_model)} · {modeLabel(r.inference_mode)}<br /><small>{r.model_id}</small></dd>
          <dt>Tokens</dt><dd>{r.input_tokens} in / {r.output_tokens} out <small>(invocation log)</small></dd>
          <dt>Duration</dt><dd>{r.client_latency_ms === null ? "Unknown" : `${r.client_latency_ms} ms`} <small>(application measurement)</small></dd>
          <dt>Estimated inference cost</dt><dd>{usd(r.estimated_cost_usd)} <small>({r.source_region} price, effective {orUnknown(r.price_effective_date)})</small></dd>
          <dt>Workload</dt><dd>{orUnknown(r.workload)} · item {orUnknown(r.item_id)} · score {r.workload === "summarize" ? "not scored" : orUnknown(r.score)}</dd>
          <dt>Phase</dt><dd>{orUnknown(r.phase)}</dd>
          <dt>Time</dt><dd>{r.timestamp}</dd>
          <dt>Request ID</dt><dd><code>{r.request_id}</code></dd>
        </dl>
      </div>
    );
  }

  if (sel.kind === "link") {
    const l = agg.links.get(sel.key);
    const rs = reqs.filter((r) => linkKey(r.source_region, r.processing_region ?? "") === sel.key && r.region_evidence !== "direct");
    if (!l) return <Back onClick={() => setSel({ kind: "overview" })} />;
    return (
      <div>
        <Back onClick={() => setSel({ kind: "overview" })} />
        <h2>{regions[l.source].name} → {regions[l.target].name}</h2>
        <p className="muted">Logical relationship: called in {l.source}, processed in {l.target}. Not a network path.</p>
        <div className="stats">
          <Stat label="Requests" value={String(l.requests)} />
          <Stat label="Est. cost" value={usd(l.cost)} />
          <Stat label="Verified" value={`${l.verified}/${l.requests}`} />
        </div>
        <p className="note">Billed at <b>{regions[l.source].name}</b> prices — the source region, not the processing region.</p>
        <h3>By model and route</h3>
        <Table rows={groupBy(rs, (r) => `${modelLabel(r.base_model)} · ${modeLabel(r.inference_mode)}`)} />
        <h3>Requests (latest first)</h3>
        <RequestList rs={rs} onPick={(id) => setSel({ kind: "request", id, back: sel })} />
      </div>
    );
  }

  if (sel.kind === "region") {
    const code = sel.region;
    const billed = reqs.filter((r) => r.source_region === code);
    const processed = reqs.filter((r) => r.processing_region === code);
    return (
      <div>
        <Back onClick={() => setSel({ kind: "overview" })} />
        <h2>{regions[code].name} <small>{code}</small></h2>
        <h3>Called from here (billed here)</h3>
        {billed.length ? (
          <>
            <div className="stats">
              <Stat label="Requests" value={String(billed.length)} />
              <Stat label="Est. cost" value={usd(sum(billed))} />
              <Stat label="Tokens out" value={String(billed.reduce((a, r) => a + r.output_tokens, 0))} />
            </div>
            <h4>By team</h4>
            <Table rows={groupBy(billed, (r) => r.team)} />
            <h4>By model</h4>
            <Table rows={groupBy(billed, (r) => modelLabel(r.base_model))} />
          </>
        ) : <p className="muted">No calls originate here.</p>}
        <h3>Processed here</h3>
        {processed.length ? (
          <Table rows={groupBy(processed, (r) => `from ${regions[r.source_region].name}${r.region_evidence === "direct" ? " (direct)" : ""}`)} />
        ) : <p className="muted">No requests processed here.</p>}
        <h3>Requests</h3>
        <RequestList rs={[...billed, ...processed.filter((r) => r.source_region !== code)]} onPick={(id) => setSel({ kind: "request", id, back: sel })} />
      </div>
    );
  }

  const unpriced = reqs.filter((r) => r.estimated_cost_usd === null).length;
  const ev = (e: string) => reqs.filter((r) => r.region_evidence === e).length;
  return (
    <div>
      <div className="stats">
        <Stat label="Requests" value={String(reqs.length)} />
        <Stat label="Est. inference cost" value={usd(sum(reqs))} />
        <Stat label="Unpriced" value={String(unpriced)} />
      </div>
      <h3>Processing region evidence</h3>
      <p>
        <Badge e="verified" /> {ev("verified")} &nbsp; <Badge e="observed" /> {ev("observed")} &nbsp;
        <Badge e="direct" /> {ev("direct")} &nbsp; <Badge e="unknown" /> {ev("unknown") + ev("conflict")}
      </p>
      <h3>By team</h3>
      <Table rows={groupBy(reqs, (r) => r.team)} />
      <h3>Legend</h3>
      <ul className="legend">
        <li><i className="dot src" /> Source region — size = estimated cost, color = selected metric</li>
        <li><i className="dot proc" /> Processing region — size = requests</li>
        <li><i className="line ver" /> Observed cross-region processing (verified)</li>
        <li><i className="line obs" /> Observed by one source only</li>
      </ul>
      <p className="muted">Click a line to follow its requests, or a region for its breakdown.</p>
      <h3>About this dataset</h3>
      <p className="muted">
        Collected {meta.collection_start} – {meta.collection_end} · {meta.records} records · sources{" "}
        {meta.source_regions.join(", ")} · prices effective {meta.price_effective_dates.join(", ")}
      </p>
      <details>
        <summary>Limitations</summary>
        <ul>{meta.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
      </details>
    </div>
  );
}

function Back({ onClick }: { onClick: () => void }) {
  return <button className="back" onClick={onClick}>← Back</button>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="stat"><span>{label}</span><b>{value}</b></div>;
}

function RequestList({ rs, onPick }: { rs: Req[]; onPick: (id: string) => void }) {
  const latest = [...rs].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 40);
  return (
    <ul className="reqs">
      {latest.map((r) => (
        <li key={r.request_id} onClick={() => onPick(r.request_id)}>
          <span>{r.timestamp.slice(11, 19)}</span>
          <span>{r.identity}</span>
          <span>{modelLabel(r.base_model)}</span>
          <span className="num">{usd(r.estimated_cost_usd)}</span>
        </li>
      ))}
      {rs.length > latest.length && <li className="muted">… {rs.length - latest.length} more</li>}
    </ul>
  );
}
