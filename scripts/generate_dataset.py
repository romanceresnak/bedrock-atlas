"""Generate the Bedrock Atlas test dataset with real Bedrock calls.

Each team role runs its own workload over synthetic texts (dataset/inputs.json)
on every route below. The client-side manifest stores what was requested,
measured latency and benchmark score; usage, identity and processing region
come from invocation logs / CloudTrail later.

Usage:
  AWS_PROFILE=bedrock-atlas python scripts/generate_dataset.py --phase baseline
  AWS_PROFILE=bedrock-atlas python scripts/generate_dataset.py --phase spike

Phase "spike" is a controlled scenario: the research team asks for detailed
analyses instead of one-sentence summaries (same number of requests).
"""
import argparse
import json
import time
from datetime import datetime, timezone
from pathlib import Path

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

ROOT = Path(__file__).resolve().parent.parent
INPUTS = ROOT / "dataset" / "inputs.json"
MANIFEST = ROOT / "data" / "private" / "manifest.jsonl"

BUDGET_USD = 25.0
HAIKU = "anthropic.claude-haiku-4-5-20251001-v1:0"
NOVA = "amazon.nova-lite-v1:0"

# (source region, model or inference profile id, base model)
ROUTES = [
    ("eu-central-1", f"eu.{NOVA}", NOVA),
    ("eu-central-1", f"eu.{HAIKU}", HAIKU),
    ("eu-central-1", f"global.{HAIKU}", HAIKU),
    ("us-east-1", NOVA, NOVA),
    ("us-east-1", f"us.{NOVA}", NOVA),
    ("us-east-1", f"us.{HAIKU}", HAIKU),
]

# Budget guard only: deliberately high per-1M-token prices so the guard stops
# early rather than late. Real pricing lives in the pricing table, not here.
GUARD_PRICE = {HAIKU: (1.5, 7.5), NOVA: (0.1, 0.4)}

SESSIONS = ["app", "notebook"]


def guard_cost(base_model, usage):
    p_in, p_out = GUARD_PRICE[base_model]
    return usage["inputTokens"] / 1e6 * p_in + usage["outputTokens"] / 1e6 * p_out


def spent_so_far():
    if not MANIFEST.exists():
        return 0.0
    return sum(json.loads(l).get("guard_cost_usd", 0) for l in MANIFEST.read_text().splitlines())


def team_session(account, team, session_name):
    creds = boto3.client("sts").assume_role(
        RoleArn=f"arn:aws:iam::{account}:role/bedrock-atlas-team-{team}",
        RoleSessionName=f"{team}-{session_name}",
    )["Credentials"]
    return boto3.Session(
        aws_access_key_id=creds["AccessKeyId"],
        aws_secret_access_key=creds["SecretAccessKey"],
        aws_session_token=creds["SessionToken"],
    )


def score(workload, item, answer):
    """1/0 for workloads with a known answer, None where we do not score."""
    if workload == "classify":
        return int(answer.strip().lower().strip(".") == item["expected"])
    if workload == "extract":
        try:
            got = json.loads(answer.strip().removeprefix("```json").removesuffix("```"))
        except json.JSONDecodeError:
            return 0
        exp = item["expected"]
        return int(
            str(got.get("product", "")).lower() == exp["product"].lower()
            and float(got.get("price", -1)) == exp["price"]
            and str(got.get("currency", "")).upper() == exp["currency"]
            and str(got.get("color", "")).lower() == exp["color"]
        )
    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--phase", choices=["baseline", "spike"], required=True)
    args = parser.parse_args()

    inputs = json.loads(INPUTS.read_text())["workloads"]
    account = boto3.client("sts").get_caller_identity()["Account"]
    retry = Config(retries={"mode": "adaptive", "max_attempts": 10})
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    spent = spent_so_far()

    with MANIFEST.open("a") as out:
        for workload, spec in inputs.items():
            team = spec["team"]
            detailed = args.phase == "spike" and workload == "summarize"
            template = spec["prompt_detailed"] if detailed else spec["prompt"]
            sessions = {s: team_session(account, team, s) for s in SESSIONS}

            for i, item in enumerate(spec["items"]):
                session_name = SESSIONS[i % len(SESSIONS)]
                for region, model_id, base_model in ROUTES:
                    if spent >= BUDGET_USD:
                        print(f"Budget guard reached (${spent:.2f}). Stopping.")
                        return
                    client = sessions[session_name].client(
                        "bedrock-runtime", region_name=region, config=retry
                    )
                    record = {
                        "ts": datetime.now(timezone.utc).isoformat(),
                        "phase": args.phase,
                        "team": team,
                        "session": f"{team}-{session_name}",
                        "workload": workload,
                        "item_id": item["id"],
                        "source_region": region,
                        "model_id": model_id,
                        "base_model": base_model,
                    }
                    start = time.perf_counter()
                    try:
                        resp = client.converse(
                            modelId=model_id,
                            messages=[{"role": "user", "content": [{"text": template.format(text=item["text"])}]}],
                            inferenceConfig={"maxTokens": 1000 if detailed else 200, "temperature": 0},
                            requestMetadata={"workload": workload, "phase": args.phase, "item": item["id"]},
                        )
                    except ClientError as e:
                        record |= {"status": "error", "error": e.response["Error"]["Code"]}
                        out.write(json.dumps(record) + "\n")
                        print(f"{team:9} {region:13} {model_id:50} ERROR {record['error']}")
                        continue

                    answer = resp["output"]["message"]["content"][0]["text"]
                    cost = guard_cost(base_model, resp["usage"])
                    spent += cost
                    record |= {
                        "status": "ok",
                        "request_id": resp["ResponseMetadata"]["RequestId"],
                        "client_latency_ms": round((time.perf_counter() - start) * 1000),
                        "service_latency_ms": resp["metrics"]["latencyMs"],
                        "input_tokens": resp["usage"]["inputTokens"],
                        "output_tokens": resp["usage"]["outputTokens"],
                        "answer": answer,
                        "score": score(workload, item, answer),
                        "guard_cost_usd": cost,
                    }
                    out.write(json.dumps(record) + "\n")
                    print(
                        f"{team:9} {region:13} {model_id:50} "
                        f"in={record['input_tokens']:5} out={record['output_tokens']:5} "
                        f"score={record['score']} spent=${spent:.4f}"
                    )


if __name__ == "__main__":
    main()
