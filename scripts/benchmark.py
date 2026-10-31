"""Benchmark scoring rules, shared by the generator and the normalizer."""
import json


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
