"""One-off discovery: dump AWS Price List entries for our models and regions.

Output goes to data/private/pricing_raw.json so we can see the exact
attribute names before writing the real pricing extractor.

Usage:  AWS_PROFILE=bedrock-atlas python scripts/discover_pricing.py
"""
import json
from pathlib import Path

import boto3

OUT = Path(__file__).resolve().parent.parent / "data" / "private" / "pricing_raw.json"
REGIONS = ["eu-central-1", "us-east-1"]
NEEDLES = ["haiku 4.5", "haiku-4-5", "nova lite", "nova-lite"]

pricing = boto3.client("pricing", region_name="us-east-1")
codes = [
    s["ServiceCode"]
    for page in pricing.get_paginator("describe_services").paginate()
    for s in page["Services"]
    if "bedrock" in s["ServiceCode"].lower()
]
print("service codes:", codes)

found = []
for code in codes:
    for region in REGIONS:
        pages = pricing.get_paginator("get_products").paginate(
            ServiceCode=code,
            Filters=[{"Type": "TERM_MATCH", "Field": "regionCode", "Value": region}],
        )
        for page in pages:
            for raw in page["PriceList"]:
                product = json.loads(raw)
                text = json.dumps(product["product"]["attributes"]).lower()
                if any(n in text for n in NEEDLES):
                    found.append({"serviceCode": code, **product})

OUT.write_text(json.dumps(found, indent=1))
print(f"{len(found)} price entries written to {OUT}")
