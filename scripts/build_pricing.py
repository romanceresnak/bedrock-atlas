"""Build pricing/prices.json from the AWS Price List dump.

Input:  data/private/pricing_raw.json  (from scripts/discover_pricing.py)
Output: pricing/prices.json            (public, committed)

v1 scope: on-demand text input/output tokens, no caching, no batch.
Price is keyed by SOURCE region of the call and inference mode:
  in_region / geo  -> e.g. "eu.", "us." profiles or a direct model id
  global           -> "global." profiles
Anything not listed here is "Unpriced" downstream, never zero.
"""
import json
import re
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "private" / "pricing_raw.json"
OUT = ROOT / "pricing" / "prices.json"

MODELS = {
    "Claude Haiku 4.5": "anthropic.claude-haiku-4-5-20251001-v1:0",
    "Nova Lite": "amazon.nova-lite-v1:0",
}

# usagetype pattern -> (token type, inference modes it prices)
RULES = [
    # Anthropic models (AmazonBedrockFoundationModels)
    (r"^[A-Z0-9]+-MP:[A-Z0-9]+_InputTokenCount-Units$", "input", ["in_region", "geo"]),
    (r"^[A-Z0-9]+-MP:[A-Z0-9]+_OutputTokenCount-Units$", "output", ["in_region", "geo"]),
    (r"^[A-Z0-9]+-MP:[A-Z0-9]+_InputTokenCount_Global-Units$", "input", ["global"]),
    (r"^[A-Z0-9]+-MP:[A-Z0-9]+_OutputTokenCount_Global-Units$", "output", ["global"]),
    # Amazon Nova (AmazonBedrock): one on-demand price for in-region and geo profiles
    (r"^[A-Z0-9]+-NovaLite-input-tokens$", "input", ["in_region", "geo"]),
    (r"^[A-Z0-9]+-NovaLite-output-tokens$", "output", ["in_region", "geo"]),
]

UNIT_TO_PER_1M = {"1M tokens": 1, "1K tokens": 1000}


def main():
    raw = json.loads(RAW.read_text())
    retrieved = datetime.fromtimestamp(RAW.stat().st_mtime, timezone.utc).date().isoformat()
    prices = {}

    for entry in raw:
        attrs = entry["product"]["attributes"]
        model_id = MODELS.get(attrs.get("model"))
        if not model_id:
            continue
        for pattern, token_type, modes in RULES:
            if not re.match(pattern, attrs.get("usagetype", "")):
                continue
            for term in entry["terms"]["OnDemand"].values():
                for dim in term["priceDimensions"].values():
                    per_1m = float(dim["pricePerUnit"]["USD"]) * UNIT_TO_PER_1M[dim["unit"]]
                    for mode in modes:
                        key = (model_id, attrs["regionCode"], mode)
                        row = prices.setdefault(key, {
                            "base_model": model_id,
                            "source_region": attrs["regionCode"],
                            "inference_mode": mode,
                            "currency": "USD",
                            "unit": "per 1M tokens",
                            "token_categories": ["input", "output"],
                            "source": "AWS Price List API",
                            "service_code": entry["serviceCode"],
                            "usage_types": [],
                            "effective_date": term["effectiveDate"][:10],
                            "retrieved_at": retrieved,
                        })
                        row[f"{token_type}_price"] = round(per_1m, 6)
                        row["usage_types"].append(attrs["usagetype"])

    rows = sorted(prices.values(), key=lambda r: (r["base_model"], r["source_region"], r["inference_mode"]))
    OUT.write_text(json.dumps({"scope": "on-demand text tokens, no cache, no batch", "prices": rows}, indent=2) + "\n")
    for r in rows:
        print(f"{r['base_model']:42} {r['source_region']:13} {r['inference_mode']:9} in=${r['input_price']} out=${r['output_price']}  ({r['effective_date']})")


if __name__ == "__main__":
    main()
