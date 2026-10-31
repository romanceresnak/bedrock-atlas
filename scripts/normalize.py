"""Normalize raw Bedrock evidence into one record per request.

Inputs (local, private):
  data/raw/invocation-logs/**.json.gz   usage, identity, inferenceRegion
  data/raw/cloudtrail/**.json.gz        second source for inferenceRegion
  data/private/manifest.jsonl           client latency, workload, answers
Inputs (public): pricing/prices.json, config/identity_map.json, dataset/inputs.json
Output (private): data/private/records.jsonl

Usage:  python scripts/normalize.py
"""
import gzip
import json
from collections import Counter, defaultdict
from pathlib import Path

from benchmark import score

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "private" / "records.jsonl"

GEO_PREFIXES = ("eu.", "us.", "apac.", "jp.", "au.", "ca.")
CT_EVENTS = {"Converse", "ConverseStream", "InvokeModel", "InvokeModelWithResponseStream"}


def read_gz_json(pattern):
    for f in sorted(RAW.glob(pattern)):
        yield gzip.decompress(f.read_bytes()).decode()


def invocation_logs():
    seen = set()
    for text in read_gz_json("invocation-logs/**/BedrockModelInvocationLogs/**/*.json.gz"):
        for line in text.splitlines():
            rec = json.loads(line)
            if rec["requestId"] not in seen:  # dedup
                seen.add(rec["requestId"])
                yield rec


def cloudtrail_regions():
    """request id -> inferenceRegion as seen by CloudTrail."""
    regions = {}
    for text in read_gz_json("cloudtrail/AWSLogs/*/CloudTrail/**/*.json.gz"):
        for ev in json.loads(text)["Records"]:
            if ev["eventSource"] != "bedrock.amazonaws.com" or ev["eventName"] not in CT_EVENTS:
                continue
            details = ev.get("serviceEventDetails") or {}
            region = (
                (ev.get("additionalEventData") or {}).get("inferenceRegion")
                or details.get("AdditionalEventData", {}).get("additionalEntries", {}).get("inferenceRegion")
            )
            request_id = details.get("parentRequestId") or ev.get("requestID")
            if region and request_id:
                regions[request_id] = region
    return regions


def inference_mode(model_id):
    if model_id.startswith("global."):
        return "global"
    if model_id.startswith(GEO_PREFIXES):
        return "geo"
    return "in_region"


def base_model(model_id):
    model_id = model_id.split("/")[-1]  # ARN -> id
    for prefix in ("global.",) + GEO_PREFIXES:
        model_id = model_id.removeprefix(prefix)
    return model_id


def parse_identity(arn, role_map):
    # arn:aws:sts::<acct>:assumed-role/<role>/<session>  or  arn:aws:iam::<acct>:user/<name>
    resource = arn.split(":", 5)[-1]
    kind, _, rest = resource.partition("/")
    role, _, session = rest.partition("/") if kind == "assumed-role" else (None, "", "")
    return {
        "principal_arn": arn,
        "principal_type": kind,
        "role_name": role,
        "session_name": session or None,
        "team": role_map.get(role, "Unmapped"),
    }


def processing_region(source_region, mode, log_region, trail_region):
    if log_region and trail_region:
        if log_region == trail_region:
            return log_region, "verified"
        return None, "conflict"
    if log_region or trail_region:
        return log_region or trail_region, "observed"
    if mode == "in_region":
        return source_region, "direct"
    return None, "unknown"


def estimate_cost(prices, model, source_region, mode, rec):
    p = prices.get((model, source_region, mode))
    cached = rec["input"].get("cacheReadInputTokenCount", 0) + rec["input"].get("cacheWriteInputTokenCount", 0)
    if not p or cached:
        return None, "unpriced", None
    cost = (
        rec["input"]["inputTokenCount"] / 1e6 * p["input_price"]
        + rec["output"]["outputTokenCount"] / 1e6 * p["output_price"]
    )
    return round(cost, 8), "priced", p["effective_date"]


def main():
    prices = {
        (p["base_model"], p["source_region"], p["inference_mode"]): p
        for p in json.loads((ROOT / "pricing" / "prices.json").read_text())["prices"]
    }
    role_map = json.loads((ROOT / "config" / "identity_map.json").read_text())["roles"]
    items = {
        (w, i["id"]): i
        for w, spec in json.loads((ROOT / "dataset" / "inputs.json").read_text())["workloads"].items()
        for i in spec["items"]
    }
    manifest = {}
    for line in (ROOT / "data" / "private" / "manifest.jsonl").read_text().splitlines():
        m = json.loads(line)
        if m.get("request_id"):
            manifest[m["request_id"]] = m
    trail = cloudtrail_regions()

    records = []
    for rec in invocation_logs():
        rid = rec["requestId"]
        src = rec["region"]
        mode = inference_mode(rec["modelId"])
        model = base_model(rec["modelId"])
        region, evidence = processing_region(src, mode, rec.get("inferenceRegion"), trail.get(rid))
        cost, cost_status, price_date = estimate_cost(prices, model, src, mode, rec)
        m = manifest.get(rid, {})
        meta = rec.get("requestMetadata") or {}
        workload = m.get("workload") or meta.get("workload")
        item = items.get((workload, m.get("item_id")))

        records.append({
            "request_id": rid,
            "timestamp": rec["timestamp"],
            "operation": rec["operation"],
            "source_region": src,
            "model_id": rec["modelId"],
            "base_model": model,
            "inference_mode": mode,
            "processing_region": region,
            "region_evidence": evidence,
            "region_sources": [s for s, v in (("invocation_log", rec.get("inferenceRegion")), ("cloudtrail", trail.get(rid))) if v],
            **parse_identity(rec["identity"]["arn"], role_map),
            "input_tokens": rec["input"]["inputTokenCount"],
            "output_tokens": rec["output"]["outputTokenCount"],
            "estimated_cost_usd": cost,
            "cost_status": cost_status,
            "price_effective_date": price_date,
            "client_latency_ms": m.get("client_latency_ms"),
            "service_latency_ms": m.get("service_latency_ms"),
            "workload": workload,
            "phase": m.get("phase") or meta.get("phase") or meta.get("run"),
            "item_id": m.get("item_id"),
            "score": score(workload, item, m["answer"]) if item and "answer" in m else None,
        })

    records.sort(key=lambda r: r["timestamp"])
    OUT.write_text("".join(json.dumps(r) + "\n" for r in records))

    print(f"{len(records)} records -> {OUT.relative_to(ROOT)}")
    print("region evidence:", dict(Counter(r["region_evidence"] for r in records)))
    print("cost status:   ", dict(Counter(r["cost_status"] for r in records)))
    print("manifest join: ", sum(1 for r in records if r["client_latency_ms"] is not None), "with client latency")
    totals = defaultdict(float)
    for r in records:
        totals[(r["phase"], r["team"])] += r["estimated_cost_usd"] or 0
    for (phase, team), usd in sorted(totals.items(), key=lambda kv: str(kv[0])):
        print(f"  {str(phase):9} {team:10} ${usd:.4f}")


if __name__ == "__main__":
    main()
