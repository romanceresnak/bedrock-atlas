"""Live demo API behind CloudFront /api/live.

GET  /api/live       -> available routes and remaining calls today
POST /api/live       -> {"route": "<id>"}: one Converse call with a FIXED prompt
GET  /api/live/{id}  -> request status; processing region arrives from the
                        invocation log via log_processor.py
"""
import base64
import json
import os
import time
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import boto3

TABLE = boto3.resource("dynamodb").Table(os.environ["TABLE"])
DAILY_CAP = int(os.environ["DAILY_CAP"])
PROMPT = "In one sentence: what is Amazon Bedrock?"

HAIKU = "anthropic.claude-haiku-4-5-20251001-v1:0"
NOVA = "amazon.nova-lite-v1:0"
# id: (label, source region, model or profile id, base model, inference mode)
ROUTES = {
    "fra-eu-haiku": ("Frankfurt · Claude Haiku 4.5 · eu. profile", "eu-central-1", f"eu.{HAIKU}", HAIKU, "geo"),
    "fra-global-haiku": ("Frankfurt · Claude Haiku 4.5 · global. profile", "eu-central-1", f"global.{HAIKU}", HAIKU, "global"),
    "fra-eu-nova": ("Frankfurt · Nova Lite · eu. profile", "eu-central-1", f"eu.{NOVA}", NOVA, "geo"),
    "iad-us-haiku": ("N. Virginia · Claude Haiku 4.5 · us. profile", "us-east-1", f"us.{HAIKU}", HAIKU, "geo"),
    "iad-direct-nova": ("N. Virginia · Nova Lite · direct", "us-east-1", NOVA, NOVA, "in_region"),
}

with open(os.path.join(os.path.dirname(__file__), "prices.json")) as f:
    PRICES = {(p["base_model"], p["source_region"], p["inference_mode"]): p for p in json.load(f)["prices"]}


def response(status, body):
    return {
        "statusCode": status,
        "headers": {"content-type": "application/json", "cache-control": "no-store"},
        "body": json.dumps(body, default=lambda d: float(d) if isinstance(d, Decimal) else str(d)),
    }


def expires(days):
    return int((datetime.now(timezone.utc) + timedelta(days=days)).timestamp())


def counter_key():
    return f"counter#{datetime.now(timezone.utc).date().isoformat()}"


def update(item_id, fields):
    """SET fields without overwriting what the log processor may already have written."""
    names = {f"#{k}": k for k in fields}
    values = {f":{k}": v for k, v in fields.items()}
    TABLE.update_item(
        Key={"id": item_id},
        UpdateExpression="SET " + ", ".join(f"#{k} = :{k}" for k in fields),
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
    )


def config():
    used = TABLE.get_item(Key={"id": counter_key()}).get("Item", {}).get("calls", 0)
    return response(200, {
        "prompt": PROMPT,
        "remaining_today": max(DAILY_CAP - int(used), 0),
        "routes": [{"id": k, "label": v[0], "source_region": v[1]} for k, v in ROUTES.items()],
    })


def invoke(body):
    route_id = body.get("route")
    if route_id not in ROUTES:
        return response(400, {"error": "Unknown route."})
    try:
        TABLE.update_item(
            Key={"id": counter_key()},
            UpdateExpression="ADD calls :one SET expires_at = :exp",
            ConditionExpression="attribute_not_exists(calls) OR calls < :cap",
            ExpressionAttributeValues={":one": 1, ":cap": DAILY_CAP, ":exp": expires(2)},
        )
    except TABLE.meta.client.exceptions.ConditionalCheckFailedException:
        return response(429, {"error": "Daily limit for live calls reached. Please try again tomorrow."})

    label, region, model_id, base_model, mode = ROUTES[route_id]
    client = boto3.client("bedrock-runtime", region_name=region)
    start = time.perf_counter()
    r = client.converse(
        modelId=model_id,
        messages=[{"role": "user", "content": [{"text": PROMPT}]}],
        inferenceConfig={"maxTokens": 80, "temperature": 0},
    )
    latency = round((time.perf_counter() - start) * 1000)

    usage = r["usage"]
    price = PRICES.get((base_model, region, mode))
    cost = None
    if price:
        cost = usage["inputTokens"] / 1e6 * price["input_price"] + usage["outputTokens"] / 1e6 * price["output_price"]

    request_id = r["ResponseMetadata"]["RequestId"]
    fields = {
        "kind": "request",
        "route": route_id,
        "route_label": label,
        "timestamp": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source_region": region,
        "model_id": model_id,
        "base_model": base_model,
        "inference_mode": mode,
        "input_tokens": usage["inputTokens"],
        "output_tokens": usage["outputTokens"],
        "client_latency_ms": latency,
        "service_latency_ms": r["metrics"]["latencyMs"],
        "estimated_cost_usd": Decimal(str(round(cost, 8))) if cost is not None else None,
        "price_effective_date": price["effective_date"] if price else None,
        "answer": r["output"]["message"]["content"][0]["text"],
        "expires_at": expires(1),
    }
    if mode == "in_region":
        fields |= {"processing_region": region, "region_evidence": "direct"}
    update(request_id, fields)
    return status(request_id)


def status(request_id):
    item = TABLE.get_item(Key={"id": request_id}).get("Item")
    if not item or item.get("kind") != "request":
        return response(404, {"error": "Not found."})
    return response(200, {"request_id": request_id, **{k: v for k, v in item.items() if k not in ("id", "kind", "expires_at")}})


def handler(event, context):
    method = event["requestContext"]["http"]["method"]
    if method == "POST":
        raw = event.get("body") or "{}"
        if event.get("isBase64Encoded"):
            raw = base64.b64decode(raw).decode()
        return invoke(json.loads(raw))
    if event.get("pathParameters", {}).get("id"):
        return status(event["pathParameters"]["id"])
    return config()
