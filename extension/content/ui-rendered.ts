import { AnalysisResponse } from '../shared/types';

declare const chrome: any;

export class UiRenderer {
  private overlayId = 'market-trust-overlay-root';

  public injectOverlay(): void {
    if (document.getElementById(this.overlayId)) {
      return;
    }

    const overlayContainer = document.createElement('div');
    overlayContainer.id = this.overlayId;

    const logoUrl = chrome.runtime.getURL('ui/images/icon.svg');

    overlayContainer.innerHTML = `
      <div id="market-trust-card" class="mt-container">
        <div class="mt-header">
          <div class="mt-brand">
            <span class="mt-title">Market Trust</span>
          </div>
          <button id="mt-close-btn" class="mt-close-btn">&times;</button>
        </div>

        <div class="mt-body">
          <div class="mt-score-container">
            <span id="mt-score-value" class="mt-score-value">--</span>
            <span class="mt-score-max">/100</span>
          </div>
          <div id="mt-risk-label" class="mt-risk-label pending">Analyzing Listing...</div>
        </div>

        <div class="mt-details-container">
          <button id="mt-toggle-btn" class="mt-details-toggle">
            <span>▼ Why?</span>
          </button>
          <div id="mt-details-content" class="mt-details-content mt-collapsed">
            <ul id="mt-signals-list" class="mt-signals-list">
              <li class="mt-signal">Extracting listing signals...</li>
            </ul>
            <p class="mt-disclaimer">This score identifies detected risk signals. It does NOT prove that the seller is a scammer.</p>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlayContainer);
    this.attachEventListeners();
  }

  private attachEventListeners(): void {
    const closeBtn = document.getElementById('mt-close-btn');
    const card = document.getElementById('market-trust-card');
    const toggleBtn = document.getElementById('mt-toggle-btn');
    const content = document.getElementById('mt-details-content');

    if (closeBtn && card) {
      closeBtn.addEventListener('click', () => {
        card.classList.add('hidden');
      });
    }

    if (toggleBtn && content) {
      toggleBtn.addEventListener('click', () => {
        const isCollapsed = content.classList.contains('mt-collapsed');
        if (isCollapsed) {
          content.classList.remove('mt-collapsed');
          content.classList.add('mt-expanded');
          toggleBtn.innerHTML = '▲ Hide Details';
        } else {
          content.classList.remove('mt-expanded');
          content.classList.add('mt-collapsed');
          toggleBtn.innerHTML = '▼ Why?';
        }
      });
    }
  }

  public renderAnalysis(analysis: AnalysisResponse): void {
    const scoreVal = document.getElementById('mt-score-value');
    const riskLabel = document.getElementById('mt-risk-label');
    const signalsList = document.getElementById('mt-signals-list');

    if (scoreVal) {
      scoreVal.textContent = String(analysis.risk_score);
    }

    if (riskLabel) {
      riskLabel.textContent = `${analysis.risk_level.replace('_', ' ')} detected risk`;
      riskLabel.className = `mt-risk-label ${analysis.risk_level.replace('_', '')}`;
    }

    if (signalsList) {
      if (analysis.signals.length === 0) {
        signalsList.innerHTML = `<li class="mt-signal mt-low">No elevated risk triggers detected in visible page text.</li>`;
      } else {
        signalsList.innerHTML = analysis.signals
          .map(
            sig => `<li class="mt-signal mt-${analysis.risk_level}">${sig.explanation}</li>`
          )
          .join('');
      }
    }
  }

  public renderError(message: string): void {
    const riskLabel = document.getElementById('mt-risk-label');
    const signalsList = document.getElementById('mt-signals-list');

    if (riskLabel) {
      riskLabel.textContent = 'API Error';
      riskLabel.className = 'mt-risk-label high';
    }

    if (signalsList) {
      signalsList.innerHTML = `<li class="mt-signal mt-high">${message}</li>`;
    }
  }
}