"""Milestone 1 check: can we join usage, identity and processing region?

Prints, per source region, recent Bedrock CloudTrail events and invocation
log records, so both can be matched by request id.

Usage:  AWS_PROFILE=bedrock-atlas python scripts/check_milestone.py
"""
import gzip
import json

import boto3

REGIONS = ["eu-central-1", "us-east-1"]


def find(obj, key):
    """Return the first value of `key` anywhere in a nested dict/list, else None."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k == key:
                return v
            found = find(v, key)
            if found is not None:
                return found
    elif isinstance(obj, list):
        for v in obj:
            found = find(v, key)
            if found is not None:
                return found
    return None


def trail_events(region):
    ct = boto3.client("cloudtrail", region_name=region)
    events = []
    for name in ["Converse", "ConverseStream"]:
        events += ct.lookup_events(
            LookupAttributes=[{"AttributeKey": "EventName", "AttributeValue": name}],
            MaxResults=20,
        )["Events"]
    for e in events:
        ev = json.loads(e["CloudTrailEvent"])
        print(
            f"  {ev['eventName']:15} request_id={ev.get('requestID')} "
            f"parent={find(ev, 'parentRequestId')} "
            f"inferenceRegion={find(ev, 'inferenceRegion') or 'Unknown'} "
            f"arn={ev['userIdentity'].get('arn')}"
        )


def invocation_logs(region, account):
    s3 = boto3.client("s3", region_name=region)
    bucket = f"bedrock-atlas-invocation-logs-{account}-{region}"
    objs = s3.list_objects_v2(Bucket=bucket, Prefix="invocations/").get("Contents", [])
    for obj in objs:
        body = s3.get_object(Bucket=bucket, Key=obj["Key"])["Body"].read()
        if obj["Key"].endswith(".gz"):
            body = gzip.decompress(body)
        for line in body.decode().splitlines():
            rec = json.loads(line)
            print(
                f"  {rec.get('operation'):15} request_id={rec.get('requestId')} "
                f"model={rec.get('modelId')} "
                f"in={find(rec, 'inputTokenCount')} out={find(rec, 'outputTokenCount')} "
                f"inferenceRegion={find(rec, 'inferenceRegion') or 'Unknown'} "
                f"metadata={rec.get('requestMetadata')} arn={find(rec, 'arn')}"
            )


def main():
    account = boto3.client("sts").get_caller_identity()["Account"]
    for region in REGIONS:
        print(f"\n=== {region}: CloudTrail ===")
        trail_events(region)
        print(f"=== {region}: invocation logs ===")
        invocation_logs(region, account)


if __name__ == "__main__":
    main()
