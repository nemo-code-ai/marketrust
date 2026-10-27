import type { FeedbackLabel } from '../shared/messages';
import type { AnalysisResponse } from '../shared/types';
import overlayCss from '../ui/overlay.css';

type Band = 'low' | 'moderate' | 'elevated' | 'high' | 'veryhigh';
type FeedbackHandler = (label: FeedbackLabel) => Promise<boolean>;

// The colour band comes from the numeric score, so backend label strings can change freely.
// "Low" never says "safe": we only report what we checked.
function bandFor(score: number, hasFlags: boolean): { band: Band; label: string } {
  if (score <= 20) return { band: 'low', label: hasFlags ? 'Minor flags only' : 'No red flags found' };
  if (score <= 40) return { band: 'moderate', label: 'Moderate risk' };
  if (score <= 60) return { band: 'elevated', label: 'Elevated risk' };
  if (score <= 80) return { band: 'high', label: 'High risk' };
  return { band: 'veryhigh', label: 'Very high risk' };
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text; // textContent, never innerHTML: API text is untrusted
  return node;
}

export class Overlay {
  private host: HTMLElement | null = null;
  private card!: HTMLElement;
  private score!: HTMLElement;
  private label!: HTMLElement;
  private signals!: HTMLElement;
  private tipsSection!: HTMLElement;
  private tips!: HTMLElement;
  private feedback!: HTMLElement;
  private feedbackStatus!: HTMLElement;
  private feedbackButtons: HTMLButtonElement[] = [];
  private details!: HTMLElement;
  private toggle!: HTMLButtonElement;
  private onFeedback: FeedbackHandler | null = null;

  /** Shows the card in its "analyzing" state (creating it on first use). */
  showLoading(): void {
    this.ensureMounted();
    this.card.classList.remove('mt-hidden');
    this.score.textContent = '--';
    this.setLabel('pending', 'Analyzing listing...');
    this.signals.replaceChildren(el('li', 'mt-signal mt-sev-info', 'Reading listing details...'));
    this.clearExtras();
  }

  renderAnalysis(result: AnalysisResponse, onFeedback: FeedbackHandler): void {
    this.ensureMounted();
    this.card.classList.remove('mt-hidden');

    const realSignals = result.signals.filter((s) => s.severity > 0);
    const { band, label } = bandFor(result.risk_score, realSignals.length > 0);
    this.score.textContent = String(result.risk_score);
    this.setLabel(band, label);

    if (result.signals.length === 0) {
      this.signals.replaceChildren(
        el('li', 'mt-signal mt-sev-low', 'No red flags found in the listing text, price or seller profile.')
      );
    } else {
      this.signals.replaceChildren(
        ...result.signals.map((s) => {
          const sev = s.severity === 0 ? 'info' : s.severity >= 0.8 ? 'high' : 'mid';
          return el('li', `mt-signal mt-sev-${sev}`, s.explanation);
        })
      );
    }

    this.tips.replaceChildren(...result.checklist.map((tip) => el('li', undefined, tip)));
    this.tipsSection.hidden = result.checklist.length === 0;

    this.onFeedback = onFeedback;
    this.resetFeedback();
    this.feedback.hidden = false;

    this.setDetailsOpen(result.risk_score > 40); // open by default when there's something to read
  }

  renderError(message: string): void {
    this.ensureMounted();
    this.card.classList.remove('mt-hidden');
    this.score.textContent = '--';
    this.setLabel('error', 'Unavailable');
    this.signals.replaceChildren(el('li', 'mt-signal mt-sev-high', message));
    this.clearExtras();
    this.setDetailsOpen(true);
  }

  hide(): void {
    this.card?.classList.add('mt-hidden');
  }

  /** Removes the card from the page entirely (used when this script instance is orphaned). */
  destroy(): void {
    this.host?.remove();
    this.host = null;
  }

  // ---- internals ----

  private setLabel(cls: string, text: string): void {
    this.label.className = `mt-risk-label ${cls}`;
    this.label.textContent = text;
  }

  private setDetailsOpen(open: boolean): void {
    this.details.hidden = !open;
    this.toggle.textContent = open ? '▲ Hide details' : '▼ Details & safety tips';
  }

  private clearExtras(): void {
    this.tips.replaceChildren();
    this.tipsSection.hidden = true;
    this.feedback.hidden = true;
    this.onFeedback = null;
  }

  private resetFeedback(): void {
    this.feedbackStatus.textContent = '';
    this.feedbackButtons.forEach((b) => (b.disabled = false));
  }

  private async submitFeedback(label: FeedbackLabel): Promise<void> {
    if (!this.onFeedback) return;
    this.feedbackButtons.forEach((b) => (b.disabled = true));
    this.feedbackStatus.textContent = 'Saving...';

    const saved = await this.onFeedback(label);
    if (saved) {
      this.feedbackStatus.textContent = 'Thanks, saved.';
    } else {
      this.feedbackStatus.textContent = "Couldn't save. Is the server running?";
      this.feedbackButtons.forEach((b) => (b.disabled = false));
    }
  }

  private ensureMounted(): void {
    // Facebook's React tree can wipe nodes; re-attach if our host was removed.
    if (this.host?.isConnected) return;
    if (this.host) {
      document.documentElement.appendChild(this.host);
      return;
    }

    this.host = document.createElement('div');
    this.host.id = 'marketrust-root';
    const shadow = this.host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = overlayCss;

    this.card = el('div', 'mt-container');
    this.card.setAttribute('role', 'complementary');
    this.card.setAttribute('aria-label', 'MarkeTrust listing analysis');

    // Header
    const header = el('div', 'mt-header');
    const brand = el('div', 'mt-brand');
    const logo = el('img', 'mt-logo');
    logo.alt = '';
    try {
      logo.src = chrome.runtime.getURL('ui/images/icon.svg');
    } catch {
      /* extension context invalidated: render without logo */
    }
    brand.append(logo, el('span', 'mt-title', 'MarkeTrust'));
    const close = el('button', 'mt-close-btn', '×');
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => this.hide());
    header.append(brand, close);

    // Score
    const body = el('div', 'mt-body');
    const scoreRow = el('div');
    this.score = el('span', 'mt-score-value', '--');
    scoreRow.append(this.score, el('span', 'mt-score-max', '/100'));
    this.label = el('div', 'mt-risk-label pending', 'Analyzing listing...');
    body.append(scoreRow, this.label);

    // Details: signals, safety tips, coverage, feedback
    const detailsWrap = el('div', 'mt-details');
    this.toggle = el('button', 'mt-toggle');
    this.toggle.addEventListener('click', () => this.setDetailsOpen(Boolean(this.details.hidden)));
    this.details = el('div', 'mt-details-content');

    this.signals = el('ul', 'mt-signals');

    this.tipsSection = el('div', 'mt-tips-section');
    this.tips = el('ul', 'mt-tips');
    this.tipsSection.append(el('div', 'mt-section-title', 'Stay safe'), this.tips);

    this.feedback = el('div', 'mt-feedback');
    const buttons = el('div', 'mt-feedback-buttons');
    this.feedbackButtons = (
      [
        ['legit', '✅ Looks legit'],
        ['scam', '🚩 It is a scam']
      ] as const
    ).map(([label, text]) => {
      const btn = el('button', 'mt-feedback-btn', text);
      btn.addEventListener('click', () => void this.submitFeedback(label));
      return btn;
    });
    buttons.append(...this.feedbackButtons);
    this.feedbackStatus = el('div', 'mt-feedback-status');
    this.feedback.append(el('div', 'mt-section-title', 'Your verdict (helps improve MarkeTrust)'), buttons, this.feedbackStatus);

    this.details.append(
      this.signals,
      this.tipsSection,
      this.feedback,
      el(
        'p',
        'mt-disclaimer',
        'Checked: listing text, price and seller profile. Not checked: your chat with the seller or the item itself. These are risk signals, not proof that a seller is a scammer, and no flags does not mean safe.'
      )
    );
    detailsWrap.append(this.toggle, this.details);

    this.card.append(header, body, detailsWrap);
    shadow.append(style, this.card);
    this.clearExtras();
    this.setDetailsOpen(false);

    // documentElement (not body): less likely to be re-rendered by Facebook's React root.
    document.documentElement.appendChild(this.host);
  }
}
