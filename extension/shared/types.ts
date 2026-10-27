export interface ConfidenceValue<T> {
  value: T | null;
  confidence: number;
  source: string;
}

export interface RawExtractedListing {
  platform: string;
  listingId: ConfidenceValue<string>;
  title: ConfidenceValue<string>;
  price: ConfidenceValue<string>;
  originalPrice: ConfidenceValue<string>;
  description: ConfidenceValue<string>;
  sellerName: ConfidenceValue<string>;
  sellerProfileUrl: ConfidenceValue<string>;
  sellerJoinedYear: ConfidenceValue<number>;
  location: ConfidenceValue<string>;
  imageUrls: ConfidenceValue<string[]>;
  extractedAt: string;
}

/** Exactly what POST /api/v1/analyze expects (see backend schemas/listing.py). */
export interface AnalyzePayload {
  id: string | null;
  platform: string;
  title: string | null;
  description: string | null;
  price: number | null;
  original_price: number | null;
  currency: string | null;
  location: string | null;
  seller: { name: string | null; profile_url: string | null; joined_year: number | null };
  images: { url: string }[];
  metadata: { extraction_confidence: number; extracted_at: string };
}

export interface RiskSignal {
  type: string;
  severity: number;
  weight: number;
  explanation: string;
}

export interface AnalysisResponse {
  risk_score: number;
  risk_level: string;
  signals: RiskSignal[];
  checklist: string[];
  model_version: string;
}
