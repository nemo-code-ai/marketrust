"""Deterministic, explainable risk scoring for marketplace listings.

Every rule returns at most one RiskSignal. A signal contributes
`severity (0-1) * weight (points)` to the score, so the score is always
traceable back to the explanations shown to the user.
"""

import re
from datetime import date
from typing import Callable, List, Optional, Tuple

from backend.schemas.listing import MarketPlaceListing, RiskSignal

MODEL_VERSION = "rules-v2.0"

HIDDEN_INFO_MARKER = "[hidden information]"  # Facebook masks phone numbers/emails/links this way


def _compile(patterns: List[str]) -> List[re.Pattern[str]]:
    return [re.compile(p, re.IGNORECASE) for p in patterns]


# Payment methods that are irreversible or untraceable: almost always a scam when demanded.
UNTRACEABLE_PAYMENT = _compile([
    r"\bgift\s?cards?\b",
    r"\bcrypto(currency)?\b",
    r"\bbitcoin\b",
    r"\bwestern\s?union\b",
    r"\bmoney\s?gram\b",
    r"\bwire\s?transfer\b",
])

# Peer-to-peer apps and "pay first" language: risky when paired with a stranger.
RISKY_PAYMENT = _compile([
    r"\bzelle\b",
    r"\bcash\s?app\b",
    r"\bvenmo\b",
    r"\bdeposit\s?(first|required|only)\b",
    r"\bpay\s?(first|before\s?(pick\s?-?up|delivery|you\s?(see|come)))\b",
    r"\badvance\s?(payment|fee)\b",
    r"\btransfer\s?first\b",
    r"\binspection\s?fee\b",                      # fake rental/property listings charge to "view"
    r"\bpay\s?(for\s?)?(the\s?)?(inspection|viewing)\b",
    r"\bsend\s?(the\s?)?(money|payment|deposit)\s?first\b",
])

CONTACT_OFF_PLATFORM = _compile([
    r"\btext\s?me\b",
    r"\bwhats\s?app\b",
    r"\btelegram\b",
    r"\bcall\s?(or|/)\s?text\b",
    r"\bcontact\s?me\s?(directly|on)\b",
    r"\be-?mail\s?me\b",
    r"\b(instagram|snapchat)\b",
    r"\bdm\s?me\b",
    r"(?<!\d)(?:\+?234|0)[789]\d{2}[\s\-]?\d{3}[\s\-]?\d{4}(?!\d)",  # Nigerian mobile number
    r"(?<!\d)\+\d{1,3}[\s\-]?\d{6,12}(?!\d)",                      # international number
])

URGENCY = _compile([
    r"\burgent(ly)?\b",
    r"\bmust\s?sell\b",
    r"\bneed(s)?\s?(it\s?)?gone\b",
    r"\basap\b",
    r"\bleaving\s?(the\s?)?(country|town)\b",
    r"\brelocating\b",
])

REMOTE_HANDOFF = _compile([
    r"\bout\s?of\s?(town|the\s?country|state)\b",
    r"\b(shipping|delivery)\s?only\b",
    r"\b(agent|courier|shipper)\s?(will|to)\b",
    r"\bcan'?t\s?meet\b|\bcannot\s?meet\b",
    r"\bno\s?(pick\s?-?up|meet\s?-?ups?)\b",
    r"\bi\s?(am|'m)\s?(currently\s?)?(abroad|overseas)\b",
])


# Safety tips tied to the signal that triggered them.
SIGNAL_TIPS = {
    "suspicious_payment": "Never send a deposit, inspection fee, gift card, crypto or 'delivery fee' before the item is in your hands (or you have viewed the property).",
    "off_platform_contact": "Keep the conversation on Marketplace/Messenger, where there is a record. Be careful about moving to WhatsApp or calls.",
    "hidden_contact_info": "Be careful if the seller wants to move the chat off Facebook.",
    "remote_handoff": "Don't pay for an item you can't inspect. A courier or 'agent' who delivers after you pay is a common scam setup.",
    "new_seller_account": "Check the seller's profile: other listings, activity and reviews. Accounts can be borrowed or bought, so an old account is not proof of honesty either.",
    "urgency": "Don't let pressure rush you. A genuine seller will still be there after you've checked the item.",
    "steep_price_drop": "If the price looks too good, compare it with similar listings before you pay anything.",
    "limited_data": "Some details couldn't be read, so review the listing yourself carefully.",
}

# Always-relevant habits, shown after any signal-specific tips.
GENERAL_TIPS = [
    "Confirm payment in your own bank app. Never trust a screenshot or a 'transfer successful' message.",
    "Meet in a busy public place and bring someone with you.",
    "Inspect and test the item before you pay.",
    "Never share OTPs, verification codes or bank PINs with a buyer or seller.",
    "Pay in person or on delivery where possible; avoid paying in advance.",
]

MAX_CHECKLIST_ITEMS = 6
MAX_SIGNAL_TIPS = 4  # leave room for the general habits


def _any_match(text: str, patterns: List[re.Pattern[str]]) -> bool:
    return bool(text) and any(p.search(text) for p in patterns)


class RiskEngine:
    def __init__(self, listing: MarketPlaceListing, current_year: Optional[int] = None):
        self.listing = listing
        self.current_year = current_year or date.today().year
        self.text = f"{listing.title or ''}\n{listing.description or ''}"

    # ---- rules -------------------------------------------------------------

    def _payment(self) -> Optional[RiskSignal]:
        if _any_match(self.text, UNTRACEABLE_PAYMENT):
            severity = 1.0
        elif _any_match(self.text, RISKY_PAYMENT):
            severity = 0.7
        else:
            return None
        return RiskSignal(
            type="suspicious_payment",
            severity=severity,
            weight=45,
            explanation="Listing asks for an untraceable or pay-first payment method (e.g. gift cards, crypto, Zelle, deposit before meeting).",
        )

    def _off_platform_contact(self) -> Optional[RiskSignal]:
        if _any_match(self.text, CONTACT_OFF_PLATFORM):
            return RiskSignal(
                type="off_platform_contact",
                severity=0.7,
                weight=20,
                explanation="Seller pushes you to contact them outside the platform (WhatsApp, text, phone number, etc.).",
            )
        if HIDDEN_INFO_MARKER in (self.listing.description or "").lower():
            return RiskSignal(
                type="hidden_contact_info",
                severity=0.4,
                weight=15,
                explanation="The description contained contact details that Facebook hid, which can mean the seller wants to move the conversation off-platform.",
            )
        return None

    def _urgency(self) -> Optional[RiskSignal]:
        if _any_match(self.text, URGENCY):
            return RiskSignal(
                type="urgency",
                severity=0.6,
                weight=12,
                explanation="Listing uses pressure language (e.g. 'urgent', 'must sell', 'leaving the country').",
            )
        return None

    def _remote_handoff(self) -> Optional[RiskSignal]:
        if _any_match(self.text, REMOTE_HANDOFF):
            return RiskSignal(
                type="remote_handoff",
                severity=0.75,
                weight=20,
                explanation="Seller says they can't meet in person (out of town, courier or agent will deliver), a common scam pattern.",
            )
        return None

    def _new_seller(self) -> Optional[RiskSignal]:
        year = self.listing.seller.joined_year
        if not year or year > self.current_year or year < 2004:  # ignore impossible values
            return None
        age = self.current_year - year
        severity = {0: 0.9, 1: 0.6, 2: 0.3}.get(age)
        if severity is None:
            return None
        return RiskSignal(
            type="new_seller_account",
            severity=severity,
            weight=25,
            explanation=f"Seller's Facebook account is recent (joined {year}). Newer accounts are used more often in scams.",
        )

    def _steep_price_drop(self) -> Optional[RiskSignal]:
        price, original = self.listing.price, self.listing.original_price
        if not price or not original or price <= 0 or original <= price:
            return None
        drop = 1 - price / original
        if drop < 0.5:
            return None
        return RiskSignal(
            type="steep_price_drop",
            severity=min(1.0, drop),
            weight=10,
            explanation=f"Price was cut by {drop:.0%}. Steep markdowns can be bait, though they are also common for genuine quick sales.",
        )

    def _limited_data(self) -> Optional[RiskSignal]:
        meta = self.listing.metadata
        if meta and meta.extraction_confidence < 0.6:
            return RiskSignal(
                type="limited_data",
                severity=0.0,
                weight=0,
                explanation="Some listing details could not be read, so this score may understate the risk.",
            )
        return None

    # ---- scoring -----------------------------------------------------------

    @staticmethod
    def level_for(score: int) -> str:
        if score <= 20:
            return "low"
        if score <= 40:
            return "moderate"
        if score <= 60:
            return "elevated"
        if score <= 80:
            return "high"
        return "very_high"

    @staticmethod
    def checklist_for(signals: List[RiskSignal]) -> List[str]:
        tips: List[str] = []
        for s in signals:
            tip = SIGNAL_TIPS.get(s.type)
            if tip and tip not in tips and len(tips) < MAX_SIGNAL_TIPS:
                tips.append(tip)
        for tip in GENERAL_TIPS:
            if len(tips) >= MAX_CHECKLIST_ITEMS:
                break
            tips.append(tip)
        return tips

    def analyze(self) -> Tuple[int, str, List[RiskSignal]]:
        rules: List[Callable[[], Optional[RiskSignal]]] = [
            self._payment,
            self._off_platform_contact,
            self._urgency,
            self._remote_handoff,
            self._new_seller,
            self._steep_price_drop,
            self._limited_data,
        ]
        signals = [s for rule in rules if (s := rule()) is not None]
        signals.sort(key=lambda s: s.severity * s.weight, reverse=True)

        total = sum(s.severity * s.weight for s in signals)
        score = max(5, min(100, round(total)))  # never claim zero risk
        return score, self.level_for(score), signals
