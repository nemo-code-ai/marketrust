import re
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, model_validator
from typing_extensions import Self


class SellerInfo(BaseModel):
    name: Optional[str] = None
    profile_url: Optional[str] = None
    joined_year: Optional[int] = None  # e.g. 2011, from "Joined Facebook in 2011"
    signals: Dict[str, Any] = Field(default_factory=dict)


class ImageInfo(BaseModel):
    url: str
    hash: Optional[str] = None


class Metadata(BaseModel):
    extraction_confidence: float = 1.0
    extracted_at: Optional[str] = None


class MarketPlaceListing(BaseModel):
    id: Optional[str] = None
    platform: str
    title: Optional[str] = None
    description: Optional[str] = None
    price: Optional[float] = None
    original_price: Optional[float] = None  # struck-through price, if the seller cut it
    currency: Optional[str] = None
    location: Optional[str] = None
    seller: SellerInfo = Field(default_factory=SellerInfo)
    images: List[ImageInfo] = Field(default_factory=list)
    metadata: Optional[Metadata] = None

    @model_validator(mode="after")
    def infer_currency_if_missing(self) -> Self:
        if self.currency is not None:
            return self

        loc = (self.location or "").lower()
        words = set(re.findall(r"[a-z]+", loc))  # whole words only, so "england" != "ng"

        if words & {"lagos", "abuja", "nigeria", "ng", "ibadan", "kano", "enugu"}:
            self.currency = "NGN"
        elif words & {"london", "uk", "england", "scotland", "wales", "manchester"}:
            self.currency = "GBP"
        elif words & {"berlin", "france", "germany", "eu", "paris", "madrid"}:
            self.currency = "EUR"
        elif words & {"usa", "us", "ny", "tx", "ca"} or "united states" in loc:
            self.currency = "USD"
        else:
            self.currency = "UNKNOWN"

        return self


class RiskSignal(BaseModel):
    type: str
    severity: float
    weight: int
    explanation: str


class AnalysisResponse(BaseModel):
    risk_score: int
    risk_level: str
    signals: List[RiskSignal]
    checklist: List[str] = Field(default_factory=list)
    model_version: str


class FeedbackRequest(BaseModel):
    """A user's own verdict on a listing: the raw material for a real labeled dataset."""

    listing: MarketPlaceListing
    risk_score: int
    signal_types: List[str] = Field(default_factory=list)
    label: Literal["scam", "legit"]


# Explicitly rebuild schema to resolve any internal Pydantic type references
MarketPlaceListing.model_rebuild()
