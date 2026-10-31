"""Milestone 1: one direct and one cross-region Bedrock call as a team role.

Usage:  AWS_PROFILE=bedrock-atlas python scripts/smoke_test.py
"""
import time

import boto3
from botocore.exceptions import ClientError

TEAM = "research"
PROMPT = "In one sentence: what is Amazon Bedrock?"

CALLS = [
    # (label, source region, model or inference profile id, streaming)
    ("direct", "us-east-1", "amazon.nova-lite-v1:0", False),
    ("cross-region", "eu-central-1", "eu.amazon.nova-lite-v1:0", False),
    ("cross-region-stream", "eu-central-1", "eu.amazon.nova-lite-v1:0", True),
    ("cross-region", "eu-central-1", "eu.anthropic.claude-haiku-4-5-20251001-v1:0", False),
    ("cross-region-stream", "eu-central-1", "eu.anthropic.claude-haiku-4-5-20251001-v1:0", True),
]


def team_session(team: str) -> boto3.Session:
    account = boto3.client("sts").get_caller_identity()["Account"]
    creds = boto3.client("sts").assume_role(
        RoleArn=f"arn:aws:iam::{account}:role/bedrock-atlas-team-{team}",
        RoleSessionName=f"smoke-{team}",
    )["Credentials"]
    return boto3.Session(
        aws_access_key_id=creds["AccessKeyId"],
        aws_secret_access_key=creds["SecretAccessKey"],
        aws_session_token=creds["SessionToken"],
    )


def main() -> None:
    session = team_session(TEAM)
    for label, region, model_id, stream in CALLS:
        client = session.client("bedrock-runtime", region_name=region)
        args = dict(
            modelId=model_id,
            messages=[{"role": "user", "content": [{"text": PROMPT}]}],
            inferenceConfig={"maxTokens": 100},
            requestMetadata={"team": TEAM, "run": "smoke"},
        )
        start = time.perf_counter()
        try:
            if stream:
                resp = client.converse_stream(**args)
                usage = next(e["metadata"]["usage"] for e in resp["stream"] if "metadata" in e)
            else:
                resp = client.converse(**args)
                usage = resp["usage"]
        except ClientError as e:
            print(f"{label:20} {region:13} {model_id} FAILED: {e.response['Error']['Code']}")
            continue
        ms = round((time.perf_counter() - start) * 1000)
        print(
            f"{label:20} {region:13} request_id={resp['ResponseMetadata']['RequestId']} "
            f"in={usage['inputTokens']} out={usage['outputTokens']} {ms} ms"
        )


if __name__ == "__main__":
    main()
