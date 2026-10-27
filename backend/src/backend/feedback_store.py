"""Append-only store for user-labeled listings (one JSON object per line).

Everything stays on the machine running the backend. If MarkeTrust is ever hosted,
users must be told what is stored and give consent first.
"""

import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

from backend.risk_engine.engine import MODEL_VERSION
from backend.schemas.listing import FeedbackRequest

_lock = threading.Lock()


def feedback_path() -> Path:
    return Path(os.environ.get("MARKETRUST_DATA_DIR", "data")) / "feedback.jsonl"


def append_feedback(fb: FeedbackRequest) -> Path:
    listing = fb.listing.model_dump(mode="json")
    listing["image_count"] = len(listing.get("images", []))
    listing["images"] = []  # signed CDN links expire and add nothing to scoring

    record: Dict[str, Any] = {
        "saved_at": datetime.now(timezone.utc).isoformat(),
        "label": fb.label,
        "risk_score": fb.risk_score,
        "signal_types": fb.signal_types,
        "model_version": MODEL_VERSION,
        "listing": listing,
    }

    path = feedback_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with _lock, path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")
    return path


def load_feedback(path: Path) -> List[Dict[str, Any]]:
    if not path.exists():
        return []
    with path.open(encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]
