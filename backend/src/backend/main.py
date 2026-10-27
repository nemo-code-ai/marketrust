from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from backend.feedback_store import append_feedback
from backend.risk_engine.engine import MODEL_VERSION, RiskEngine
from backend.schemas.listing import AnalysisResponse, FeedbackRequest, MarketPlaceListing

# 1. Initialize the FastAPI Application
app = FastAPI(
    title="MarkeTrust Risk Engine API",
    version="1.0.0",
    description="Deterministic risk analysis and scam detection engine for online marketplace listings.",
)

# 2. Configure CORS (Cross-Origin Resource Sharing)
# This permits the Chrome Extension content/background scripts to make HTTP POST requests to this API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "*"
    ],  # For local MVP development; restrict to extension ID in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# health check endpoint
@app.get("/health")
def health_check():
    """
    Simple status check to verify the Uvicorn server and FastAPI application are running.
    """
    return {"status": "ok", "service": "MarkeTrust Backend", "version": MODEL_VERSION}


# 4. Core Listing Analysis Endpoint
@app.post("/api/v1/analyze", response_model=AnalysisResponse)
def analyze_listing(listing: MarketPlaceListing):
    """
    Receives a normalized MarketplaceListing payload, passes it through
    the risk engine rules, and returns an explainable risk score and signals list.
    """
    score, level, signals = RiskEngine(listing).analyze()
    return AnalysisResponse(
        risk_score=score,
        risk_level=level,
        signals=signals,
        checklist=RiskEngine.checklist_for(signals),
        model_version=MODEL_VERSION,
    )


# 5. Opt-in user labels (builds the real dataset the rules are tuned against)
@app.post("/api/v1/feedback")
def save_feedback(feedback: FeedbackRequest):
    append_feedback(feedback)
    return {"status": "saved"}
