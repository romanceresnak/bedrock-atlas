"""CloudWatch Logs subscription: copy inferenceRegion of live-demo calls to DynamoDB.

Runs in every source region; the table lives in TABLE_REGION.
"""
import base64
import gzip
import json
import os
from datetime import datetime, timezone

import boto3

TABLE = boto3.resource("dynamodb", region_name=os.environ["TABLE_REGION"]).Table(os.environ["TABLE"])
LIVE_ROLE = os.environ["LIVE_ROLE_NAME"]


def handler(event, context):
    batch = json.loads(gzip.decompress(base64.b64decode(event["awslogs"]["data"])))
    for log_event in batch["logEvents"]:
        rec = json.loads(log_event["message"])
        if f":assumed-role/{LIVE_ROLE}/" not in rec.get("identity", {}).get("arn", ""):
            continue
        fields = {"log_received_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
        if rec.get("inferenceRegion"):
            fields |= {
                "processing_region": rec["inferenceRegion"],
                "region_evidence": "observed",
                "region_sources": ["invocation_log"],
            }
        TABLE.update_item(
            Key={"id": rec["requestId"]},
            UpdateExpression="SET " + ", ".join(f"#{k} = :{k}" for k in fields),
            ExpressionAttributeNames={f"#{k}": k for k in fields},
            ExpressionAttributeValues={f":{k}": v for k, v in fields.items()},
        )
