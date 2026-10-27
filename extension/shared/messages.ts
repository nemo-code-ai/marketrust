import type { AnalysisResponse, AnalyzePayload } from './types';

export type FeedbackLabel = 'scam' | 'legit';

export interface AnalyzeRequest {
  type: 'ANALYZE_LISTING';
  payload: AnalyzePayload;
}

export interface FeedbackRequest {
  type: 'SEND_FEEDBACK';
  payload: {
    listing: AnalyzePayload;
    risk_score: number;
    signal_types: string[];
    label: FeedbackLabel;
  };
}

export type ExtensionRequest = AnalyzeRequest | FeedbackRequest;

export type AnalyzeResult =
  | { ok: true; data: AnalysisResponse }
  | { ok: false; error: string };

export type FeedbackResult = { ok: true } | { ok: false; error: string };
