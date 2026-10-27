"""Measure how well the current rules match your own labels.

    uv run python -m backend.evaluate            # uses data/feedback.jsonl
    uv run python -m backend.evaluate --threshold 31

Listings are re-scored with the CURRENT rules, so you can change weights in
engine.py and re-run this to see whether the change helped.
"""

import argparse
from typing import Any, Dict, List

from backend.feedback_store import feedback_path, load_feedback
from backend.risk_engine.engine import RiskEngine
from backend.schemas.listing import MarketPlaceListing

DEFAULT_THRESHOLD = 41  # "elevated" and above counts as flagged


def evaluate(records: List[Dict[str, Any]], threshold: int = DEFAULT_THRESHOLD) -> Dict[str, Any]:
    tp = fp = fn = tn = 0
    missed: List[str] = []
    false_alarms: List[str] = []

    for r in records:
        listing = MarketPlaceListing(**r["listing"])
        score, _, _ = RiskEngine(listing).analyze()
        flagged = score >= threshold
        is_scam = r["label"] == "scam"
        title = listing.title or "(untitled)"

        if is_scam and flagged:
            tp += 1
        elif is_scam:
            fn += 1
            missed.append(f"{title} (score {score})")
        elif flagged:
            fp += 1
            false_alarms.append(f"{title} (score {score})")
        else:
            tn += 1

    scams, legit = tp + fn, fp + tn
    return {
        "total": len(records),
        "scams": scams,
        "legit": legit,
        "threshold": threshold,
        "caught": tp,
        "missed": fn,
        "false_alarms": fp,
        "recall": tp / scams if scams else None,       # share of real scams that got flagged
        "precision": tp / (tp + fp) if (tp + fp) else None,  # share of flags that were real scams
        "missed_examples": missed[:10],
        "false_alarm_examples": false_alarms[:10],
    }


def _pct(x: Any) -> str:
    return "n/a" if x is None else f"{x:.0%}"


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate MarkeTrust rules against labeled feedback")
    parser.add_argument("--threshold", type=int, default=DEFAULT_THRESHOLD)
    args = parser.parse_args()

    records = load_feedback(feedback_path())
    if not records:
        print(f"No labeled listings found at {feedback_path()}. Use the Scam / Legit buttons in the card first.")
        return

    r = evaluate(records, args.threshold)
    print(f"Labeled listings: {r['total']}  (scams: {r['scams']}, legit: {r['legit']})")
    print(f"Flagging at score >= {r['threshold']}")
    print(f"  Scams caught:  {r['caught']}/{r['scams']}  (recall {_pct(r['recall'])})")
    print(f"  Scams missed:  {r['missed']}")
    print(f"  False alarms:  {r['false_alarms']}  (precision {_pct(r['precision'])})")
    for title in r["missed_examples"]:
        print(f"    missed: {title}")
    for title in r["false_alarm_examples"]:
        print(f"    false alarm: {title}")
    if r["total"] < 50:
        print("\nNote: fewer than 50 labels, so treat these numbers as a rough guide only.")


if __name__ == "__main__":
    main()
