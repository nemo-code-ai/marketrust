import type {
  AnalyzeRequest,
  AnalyzeResult,
  FeedbackLabel,
  FeedbackRequest,
  FeedbackResult
} from '../shared/messages';
import type { AnalysisResponse, AnalyzePayload } from '../shared/types';
import { FacebookAdapter } from './facebook-adapter';
import { Overlay } from './overlay';
import { watchRoute } from './route-watcher';

const adapter = new FacebookAdapter();
const overlay = new Overlay();

let runId = 0;
let controller: AbortController | null = null;

async function requestAnalysis(request: AnalyzeRequest): Promise<AnalyzeResult> {
  try {
    const response: AnalyzeResult | undefined = await chrome.runtime.sendMessage(request);
    return response ?? { ok: false, error: 'No response from the extension background worker.' };
  } catch (err) {
    console.error('[MarkeTrust] sendMessage failed', err);
    if (!chrome.runtime?.id) {
      // The extension was reloaded while this tab stayed open.
      return { ok: false, error: 'MarkeTrust was updated. Refresh this tab to continue.' };
    }
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Could not reach the MarkeTrust background worker: ${detail}` };
  }
}

async function submitFeedback(
  listing: AnalyzePayload,
  result: AnalysisResponse,
  label: FeedbackLabel
): Promise<boolean> {
  const request: FeedbackRequest = {
    type: 'SEND_FEEDBACK',
    payload: {
      listing,
      risk_score: result.risk_score,
      signal_types: result.signals.map((s) => s.type),
      label
    }
  };
  try {
    const response: FeedbackResult | undefined = await chrome.runtime.sendMessage(request);
    return Boolean(response?.ok);
  } catch {
    return false;
  }
}

async function handleRoute(pathname: string): Promise<void> {
  // Cancel whatever the previous listing was doing.
  controller?.abort();
  controller = new AbortController();
  const { signal } = controller;
  const myRun = ++runId;

  if (!adapter.isListingPath(pathname)) {
    overlay.hide();
    return;
  }

  overlay.showLoading();

  // Short settle delay: right after a soft navigation, the previous listing's DOM can linger briefly.
  await new Promise((r) => setTimeout(r, 400));
  if (signal.aborted || myRun !== runId) return;

  const raw = await adapter.waitForListing(signal);
  if (signal.aborted || myRun !== runId) return;

  if (!raw) {
    overlay.renderError("Couldn't read this listing. Facebook may still be loading - try reloading the tab.");
    return;
  }

  console.log('[MarkeTrust] extracted', raw);

  const payload = adapter.toPayload(raw);
  const result = await requestAnalysis({ type: 'ANALYZE_LISTING', payload });
  if (signal.aborted || myRun !== runId) return; // user already moved to another listing

  if (result.ok) {
    overlay.renderAnalysis(result.data, (label) => submitFeedback(payload, result.data, label));
  } else {
    overlay.renderError(result.error);
  }
}

watchRoute(
  (pathname) => void handleRoute(pathname),
  () => {
    controller?.abort();
    overlay.destroy();
  }
);
