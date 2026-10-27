from fastapi.testclient import TestClient

from backend.main import app
from backend.risk_engine.engine import RiskEngine
from backend.schemas.listing import MarketPlaceListing, Metadata, SellerInfo


def listing(**kw) -> MarketPlaceListing:
    base = dict(platform="facebook", title="iPhone 12", description="Clean iPhone 12, 64gb", price=170000, currency="NGN")
    base.update(kw)
    return MarketPlaceListing(**base)


def run(l, year=2026):
    return RiskEngine(l, current_year=year).analyze()


def types(signals):
    return {s.type for s in signals}


def test_clean_listing_is_low():
    score, level, signals = run(listing(seller=SellerInfo(name="A", joined_year=2011)))
    assert level == "low" and score <= 20 and signals == []


def test_real_iphone_listing_with_hidden_contact_is_still_low():
    l = listing(description="Clean iPhone 12\n64gb\nTrue Tone active\nNfid\n[hidden information]",
                original_price=200000, seller=SellerInfo(name="Ikhimalo", joined_year=2011))
    score, level, signals = run(l)
    assert types(signals) == {"hidden_contact_info"}
    assert level == "low"


def test_classic_scam_listing_is_high():
    l = listing(description="Urgent! I'm out of town, my agent will deliver. Pay first via gift card, text me on WhatsApp",
                seller=SellerInfo(name="X", joined_year=2026))
    score, level, signals = run(l)
    assert {"suspicious_payment", "off_platform_contact", "urgency", "remote_handoff", "new_seller_account"} <= types(signals)
    assert level in {"high", "very_high"}


def test_zelle_only_is_moderate_not_high():
    score, level, _ = run(listing(description="Urgent sale, pay via Zelle only"))
    assert level == "moderate"


def test_account_age_tiers():
    s = lambda y: run(listing(seller=SellerInfo(joined_year=y)))[2]
    assert types(s(2026)) == {"new_seller_account"}
    assert types(s(2025)) == {"new_seller_account"}
    assert s(2020) == []
    assert s(1990) == []  # impossible year is ignored


def test_price_drop_threshold():
    assert "steep_price_drop" not in types(run(listing(price=170000, original_price=200000))[2])
    assert "steep_price_drop" in types(run(listing(price=80000, original_price=200000))[2])


def test_limited_data_is_informational_only():
    score, _, signals = run(listing(metadata=Metadata(extraction_confidence=0.3)))
    assert types(signals) == {"limited_data"} and score == 5


def test_word_first_no_longer_triggers_urgency():
    assert run(listing(description="First owner, never repaired"))[2] == []


def test_nigerian_phone_number_flags_contact():
    assert "off_platform_contact" in types(run(listing(description="Call 0803 123 4567"))[2])


def test_currency_inference_uses_whole_words():
    assert MarketPlaceListing(platform="x", location="Lagos, NG").currency == "NGN"
    assert MarketPlaceListing(platform="x", location="Wellington, England").currency == "GBP"
    assert MarketPlaceListing(platform="x", location="Long Beach").currency == "UNKNOWN"


def test_api_roundtrip():
    c = TestClient(app)
    r = c.post("/api/v1/analyze", json={
        "platform": "facebook", "title": "iPhone", "description": "Urgent sale, pay via Zelle only",
        "price": 100, "currency": "USD", "location": "Lagos",
        "seller": {"name": "T", "profile_url": None, "joined_year": 2011}, "images": [],
        "metadata": {"extraction_confidence": 0.9, "extracted_at": "2026-10-02T10:00:00Z"},
    })
    body = r.json()
    assert r.status_code == 200 and body["model_version"] == "rules-v2.0"
    assert body["risk_level"] == "moderate" and len(body["signals"]) == 2
    assert c.get("/health").json()["version"] == "rules-v2.0"


def test_phone_number_formats():
    for d in ["Call 08031234567", "Call +2348031234567", "Call 0803-123-4567"]:
        assert "off_platform_contact" in types(run(listing(description=d))[2]), d
    assert "off_platform_contact" not in types(run(listing(description="Price is 170,000 firm, 64gb 2020"))[2])


# ---- checklist, feedback and evaluation -------------------------------------

import json

from backend.evaluate import evaluate
from backend.feedback_store import feedback_path, load_feedback


def test_checklist_puts_signal_tips_first_and_is_capped():
    l = listing(description="Urgent! Pay first via gift card, out of town, WhatsApp me",
                seller=SellerInfo(joined_year=2026))
    _, _, signals = run(l)
    tips = RiskEngine.checklist_for(signals)
    assert len(tips) == 6 and len(set(tips)) == 6
    assert "deposit" in tips[0].lower()          # strongest signal's tip leads
    assert any("bank app" in t for t in tips)    # general habits still make it in


def test_checklist_for_clean_listing_is_general_tips():
    tips = RiskEngine.checklist_for([])
    assert 4 <= len(tips) <= 6 and any("public place" in t for t in tips)


def test_analyze_response_includes_checklist():
    r = TestClient(app).post("/api/v1/analyze", json={"platform": "facebook", "title": "x", "images": []})
    assert r.status_code == 200 and len(r.json()["checklist"]) >= 4


def test_feedback_is_saved_and_evaluated(tmp_path, monkeypatch):
    monkeypatch.setenv("MARKETRUST_DATA_DIR", str(tmp_path))
    c = TestClient(app)
    scam = {"platform": "facebook", "title": "PS5", "description": "Urgent, pay first via gift card, agent will deliver",
            "price": 1, "seller": {"joined_year": 2026}, "images": [{"url": "https://cdn/x.jpg"}]}
    fine = {"platform": "facebook", "title": "Sofa", "description": "Used sofa, good condition",
            "price": 50000, "seller": {"joined_year": 2012}, "images": []}
    missed_scam = {"platform": "facebook", "title": "Laptop", "description": "Selling my laptop", "price": 1,
                   "seller": {"joined_year": 2015}, "images": []}

    for listing_json, label in [(scam, "scam"), (fine, "legit"), (missed_scam, "scam")]:
        r = c.post("/api/v1/feedback", json={"listing": listing_json, "risk_score": 0, "signal_types": [], "label": label})
        assert r.status_code == 200 and r.json() == {"status": "saved"}

    records = load_feedback(feedback_path())
    assert len(records) == 3 and records[0]["listing"]["image_count"] == 1 and records[0]["listing"]["images"] == []

    result = evaluate(records)
    assert (result["scams"], result["legit"]) == (2, 1)
    assert result["caught"] == 1 and result["missed"] == 1 and result["false_alarms"] == 0
    assert result["recall"] == 0.5 and result["precision"] == 1.0


def test_feedback_rejects_invalid_label():
    r = TestClient(app).post("/api/v1/feedback", json={"listing": {"platform": "x"}, "risk_score": 1, "label": "maybe"})
    assert r.status_code == 422


def test_inspection_fee_scam_pattern():
    for d in ["Lovely 2 bedroom flat, pay inspection fee to view", "You must pay for inspection first"]:
        assert "suspicious_payment" in types(run(listing(description=d))[2]), d
    assert "suspicious_payment" not in types(run(listing(description="Inspection welcome, come and see it"))[2])
