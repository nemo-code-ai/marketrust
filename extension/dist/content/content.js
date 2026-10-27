"use strict";
(() => {
  // content/wait-for.ts
  function waitFor(probe, { timeoutMs = 8e3, signal, debounceMs = 150 } = {}) {
    return new Promise((resolve) => {
      let finished = false;
      let debounce;
      const observer = new MutationObserver(() => {
        window.clearTimeout(debounce);
        debounce = window.setTimeout(check, debounceMs);
      });
      const finish = (value) => {
        if (finished) return;
        finished = true;
        observer.disconnect();
        window.clearTimeout(debounce);
        window.clearTimeout(timeout);
        window.clearInterval(interval);
        signal?.removeEventListener("abort", onAbort);
        resolve(value);
      };
      const check = () => {
        const value = probe();
        if (value) finish(value);
      };
      const onAbort = () => finish(null);
      const interval = window.setInterval(check, 500);
      const timeout = window.setTimeout(() => finish(null), timeoutMs);
      if (signal?.aborted) return finish(null);
      signal?.addEventListener("abort", onAbort);
      observer.observe(document.documentElement, { childList: true, subtree: true });
      check();
    });
  }

  // content/dom-extractor.ts
  var none = () => ({ value: null, confidence: 0, source: "none" });
  var found = (value, confidence, source) => ({
    value,
    confidence,
    source
  });
  var SELLER_LINK_SELECTOR = 'a[href*="/marketplace/profile/"], a[href*="/profile.php"], a[href*="/user/"]';
  var PRICE_RE = /^(₦|NGN|\$|USD|£|GBP|€|EUR)\s?([\d][\d.,]*)$/i;
  var GENERIC_TITLES = /^(marketplace|notifications|facebook|search results?)$/i;
  var clean = (s) => (s ?? "").replace(/\s+/g, " ").trim();
  var textOf = (el2) => el2.innerText ?? el2.textContent ?? "";
  function currentListingId() {
    return location.pathname.match(/\/marketplace\/item\/(\d+)/)?.[1] ?? null;
  }
  function freshMeta(property) {
    const id = currentListingId();
    const ogUrl = document.querySelector('meta[property="og:url"]')?.getAttribute("content") ?? "";
    if (!id || !ogUrl.includes(id)) return null;
    return clean(document.querySelector(`meta[property="${property}"]`)?.getAttribute("content")) || null;
  }
  function isFacebookChrome(el2) {
    const heading = el2.querySelector("h1, h2");
    return Boolean(heading && GENERIC_TITLES.test(clean(textOf(heading))));
  }
  function getListingRoot() {
    const candidates = [
      ...document.querySelectorAll('[role="dialog"]'),
      ...document.querySelectorAll('[role="main"], main')
    ].filter((c) => !isFacebookChrome(c));
    return candidates.find((c) => c.querySelector(SELLER_LINK_SELECTOR)) ?? candidates.find((c) => findTitleElement(c)) ?? document.body;
  }
  function findTitleElement(root) {
    for (const h1 of root.querySelectorAll("h1")) {
      const text = clean(textOf(h1));
      if (text.length >= 2 && text.length <= 200 && !GENERIC_TITLES.test(text)) return h1;
    }
    return null;
  }
  function extractTitle(root) {
    const h1 = findTitleElement(root);
    if (h1) return found(clean(textOf(h1)), 0.9, "heading");
    const og = freshMeta("og:title");
    if (og) return found(og, 0.8, "og:title (verified fresh)");
    const fromTab = clean(
      document.title.replace(/^\(\d+\)\s*/, "").replace(/\s*\|\s*Facebook$/i, "").replace(/^Marketplace\s*[-–—]\s*/i, "")
    );
    if (fromTab && !GENERIC_TITLES.test(fromTab)) return found(fromTab, 0.5, "document.title");
    return none();
  }
  function isPriceLeaf(el2) {
    if (el2.children.length > 0) return false;
    const text = clean(el2.textContent);
    return text.length <= 20 && PRICE_RE.test(text);
  }
  function parseAmount(text) {
    const m = PRICE_RE.exec(text);
    return m ? parseFloat(m[2].replace(/,/g, "")) : null;
  }
  function findPriceElement(root) {
    const titleEl = findTitleElement(root);
    let fallback = null;
    for (const el2 of root.querySelectorAll("span, div, h2")) {
      if (!isPriceLeaf(el2)) continue;
      const afterTitle = titleEl ? Boolean(titleEl.compareDocumentPosition(el2) & Node.DOCUMENT_POSITION_FOLLOWING) : true;
      if (afterTitle) return { el: el2, afterTitle: true };
      fallback ??= { el: el2, afterTitle: false };
    }
    return fallback;
  }
  function extractPrice(root) {
    const hit = findPriceElement(root);
    if (!hit) return none();
    const text = clean(hit.el.textContent);
    return hit.afterTitle ? found(text, 0.85, "price-shaped text after title") : found(text, 0.5, "price-shaped text");
  }
  function extractOriginalPrice(root) {
    const hit = findPriceElement(root);
    if (!hit?.afterTitle) return none();
    const current = parseAmount(clean(hit.el.textContent));
    if (current === null) return none();
    let box = hit.el.parentElement;
    for (let i = 0; box && i < 3; i++, box = box.parentElement) {
      if (clean(box.textContent).length > 60) break;
      for (const other of box.querySelectorAll("span, div")) {
        if (other === hit.el || !isPriceLeaf(other)) continue;
        const text = clean(other.textContent);
        const amount = parseAmount(text);
        if (amount !== null && amount > current) {
          return found(text, 0.7, "higher price beside current price");
        }
      }
    }
    return none();
  }
  function extractSellerJoinedYear(root) {
    for (const el2 of root.querySelectorAll('[dir="auto"]')) {
      const text = clean(textOf(el2));
      if (text.length > 60) continue;
      const year = text.match(/\bJoined Facebook\b.*?\b((?:19|20)\d{2})\b/i)?.[1];
      if (year) return found(Number(year), 0.85, '"Joined Facebook in <year>" text');
    }
    return none();
  }
  var FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
  var PRECEDING = Node.DOCUMENT_POSITION_PRECEDING;
  var CONDITION_VALUE_RE = /^(new|used)\b/i;
  function detailsBlocks(root) {
    const headings = [...root.querySelectorAll("h2")];
    const start = headings.find((h) => /^details$/i.test(clean(textOf(h))));
    if (!start) return null;
    const end = headings.find((h) => h !== start && start.compareDocumentPosition(h) & FOLLOWING);
    return [...root.querySelectorAll('[dir="auto"]')].filter((el2) => {
      if (el2.closest("h1, h2, h3")) return false;
      if (!(start.compareDocumentPosition(el2) & FOLLOWING)) return false;
      if (end && !(end.compareDocumentPosition(el2) & PRECEDING)) return false;
      return true;
    });
  }
  function extractDescription(root, title) {
    const place = extractLocation(root).value;
    const isMetadata = (t) => t === title || /^Listed\b/i.test(t) || /approximate/i.test(t) || /^condition$/i.test(t) || CONDITION_VALUE_RE.test(t) && t.length <= 25 || Boolean(place && t.startsWith(place));
    const pick = (blocks) => {
      let best = "";
      for (const el2 of blocks) {
        if (el2.closest("a, button")) continue;
        const text = clean(textOf(el2));
        if (text.length < 8 || text.length > 5e3 || isMetadata(text)) continue;
        if (text.length > best.length) best = text;
      }
      return best;
    };
    const fromDetails = detailsBlocks(root);
    if (fromDetails) {
      const text = pick(fromDetails);
      if (text) return found(text, 0.85, 'text under "Details" heading');
    }
    const generic = pick([...root.querySelectorAll('[dir="auto"]')]);
    if (generic) return found(generic, 0.5, "longest dir=auto block (fallback)");
    const og = freshMeta("og:description");
    if (og && og.length > 10) return found(og, 0.6, "og:description (verified fresh)");
    return none();
  }
  function normalizeProfileUrl(href) {
    try {
      const u = new URL(href);
      return u.origin + u.pathname + (u.pathname.endsWith("profile.php") ? u.search : "");
    } catch {
      return href;
    }
  }
  function extractSeller(root) {
    let firstUrl = null;
    for (const link of root.querySelectorAll(SELLER_LINK_SELECTOR)) {
      const url = normalizeProfileUrl(link.href);
      firstUrl ??= url;
      const name = clean(link.textContent) || clean(link.getAttribute("aria-label"));
      if (name.length < 2 || /seller details|message|see all/i.test(name)) continue;
      return {
        name: found(name, 0.85, "seller link text"),
        profileUrl: found(url, 0.9, "seller link href")
      };
    }
    if (firstUrl) {
      return { name: none(), profileUrl: found(firstUrl, 0.7, "seller link href (no name)") };
    }
    return { name: none(), profileUrl: none() };
  }
  function extractLocation(root) {
    for (const a of root.querySelectorAll("a[href]")) {
      let path = "";
      try {
        path = new URL(a.href).pathname;
      } catch {
        continue;
      }
      if (!/^\/marketplace\/\d+\/?$/.test(path)) continue;
      const text = clean(a.textContent);
      if (text.length >= 2 && text.length <= 80) return found(text, 0.85, "city link");
    }
    for (const el2 of root.querySelectorAll('[dir="auto"]')) {
      const text = clean(textOf(el2));
      if (text.length > 120 || !/^Listed\b/i.test(text)) continue;
      const place = text.match(/\bin\s+(.+)$/i)?.[1];
      if (place) return found(clean(place), 0.6, '"Listed ... in <place>" text');
    }
    return none();
  }
  function extractImages(root) {
    const urls = /* @__PURE__ */ new Set();
    for (const img of root.querySelectorAll("img")) {
      const src = img.currentSrc || img.src;
      const size = Math.max(img.naturalWidth, img.width);
      if (src && /scontent|fbcdn/.test(src) && size >= 200) urls.add(src);
      if (urls.size >= 6) break;
    }
    return urls.size ? found([...urls], 0.8, "fbcdn images") : found([], 0, "none");
  }

  // content/facebook-adapter.ts
  var CURRENCY_BY_SYMBOL = {
    "\u20A6": "NGN",
    NGN: "NGN",
    $: "USD",
    USD: "USD",
    "\xA3": "GBP",
    GBP: "GBP",
    "\u20AC": "EUR",
    EUR: "EUR"
  };
  var FacebookAdapter = class {
    platform = "facebook";
    isListingPath(pathname = location.pathname) {
      return /\/marketplace\/item\/\d+/.test(pathname);
    }
    extractListingId() {
      return location.pathname.match(/\/marketplace\/item\/(\d+)/)?.[1] ?? null;
    }
    extractListing() {
      const root = getListingRoot();
      const id = this.extractListingId();
      const title = extractTitle(root);
      const seller = extractSeller(root);
      return {
        platform: this.platform,
        listingId: { value: id, confidence: id ? 1 : 0, source: "url-path" },
        title,
        price: extractPrice(root),
        originalPrice: extractOriginalPrice(root),
        description: extractDescription(root, title.value),
        sellerName: seller.name,
        sellerProfileUrl: seller.profileUrl,
        sellerJoinedYear: extractSellerJoinedYear(root),
        location: extractLocation(root),
        imageUrls: extractImages(root),
        extractedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
    }
    /**
     * Waits for Facebook to finish rendering: resolves once the core fields exist,
     * or after the timeout with whatever we managed to read (if we at least have a title).
     */
    async waitForListing(signal) {
      const ready = await waitFor(
        () => {
          const l = this.extractListing();
          return l.title.value && l.price.value && l.sellerProfileUrl.value ? l : null;
        },
        { signal, timeoutMs: 8e3 }
      );
      if (ready) return ready;
      if (signal.aborted) return null;
      const partial = this.extractListing();
      return partial.title.value ? partial : null;
    }
    parsePrice(text) {
      const match = text?.match(/^(\D+?)\s?([\d][\d.,]*)$/);
      if (!match) return { amount: null, currency: null };
      const symbol = match[1];
      const amount = parseFloat(match[2].replace(/,/g, ""));
      return {
        amount: Number.isFinite(amount) ? amount : null,
        currency: CURRENCY_BY_SYMBOL[symbol.toUpperCase()] ?? CURRENCY_BY_SYMBOL[symbol] ?? null
      };
    }
    toPayload(raw) {
      const price = this.parsePrice(raw.price.value);
      const original = this.parsePrice(raw.originalPrice.value);
      const core = [raw.title, raw.price, raw.description, raw.sellerProfileUrl];
      const confidence = core.reduce((sum, f) => sum + (f.value ? f.confidence : 0), 0) / core.length;
      return {
        id: raw.listingId.value,
        platform: raw.platform,
        title: raw.title.value,
        description: raw.description.value,
        price: price.amount,
        original_price: original.amount,
        currency: price.currency,
        location: raw.location.value,
        seller: {
          name: raw.sellerName.value,
          profile_url: raw.sellerProfileUrl.value,
          joined_year: raw.sellerJoinedYear.value
        },
        images: (raw.imageUrls.value ?? []).map((url) => ({ url })),
        metadata: { extraction_confidence: Number(confidence.toFixed(2)), extracted_at: raw.extractedAt }
      };
    }
  };

  // ui/overlay.css
  var overlay_default = `/* MarkeTrust overlay \u2014 white & lilac theme.
   Lives inside a Shadow DOM, so Facebook's CSS can't touch it (and ours can't leak out). */

:host {
  all: initial;
}

.mt-container {
  position: fixed;
  top: 80px;
  right: 20px;
  width: 270px;
  box-sizing: border-box;
  background: #ffffff;
  border: 1px solid #e9dcf7;
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(123, 44, 191, 0.18);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  color: #4a3c58;
  line-height: 1.4;
  z-index: 2147483647;
  overflow: hidden;
  transition: opacity 0.25s ease, transform 0.2s ease;
}

.mt-container *,
.mt-container *::before,
.mt-container *::after {
  box-sizing: border-box;
}

.mt-container.mt-hidden {
  opacity: 0;
  pointer-events: none;
  transform: translateY(-8px);
}

/* Header */
.mt-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  background: #f7f2fc;
  border-bottom: 1px solid #ebdcfc;
}

.mt-brand {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mt-logo {
  width: 22px;
  height: 22px;
  display: block;
  border-radius: 5px;
}

.mt-title {
  font-size: 14px;
  font-weight: 700;
  color: #4f1c6f;
  letter-spacing: 0.2px;
}

.mt-close-btn {
  background: none;
  border: none;
  font-size: 22px;
  line-height: 1;
  padding: 0 2px;
  cursor: pointer;
  color: #a07cc5;
}

.mt-close-btn:hover {
  color: #6a1b9a;
}

/* Score */
.mt-body {
  padding: 18px 16px;
  text-align: center;
}

.mt-score-value {
  font-size: 38px;
  font-weight: 800;
  color: #49087d;
}

.mt-score-max {
  font-size: 15px;
  font-weight: 500;
  color: #a07cc5;
}

.mt-risk-label {
  display: inline-block;
  margin-top: 6px;
  padding: 5px 14px;
  border-radius: 20px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.6px;
  text-transform: uppercase;
}

.mt-risk-label.pending  { background: #f0e6fa; color: #7b2cbf; animation: mt-pulse 1.4s ease-in-out infinite; }
.mt-risk-label.low      { background: #e8f5e9; color: #2e7d32; }
.mt-risk-label.moderate { background: #fff8e1; color: #f57f17; }
.mt-risk-label.elevated { background: #fff3e0; color: #e65100; }
.mt-risk-label.high     { background: #ffebee; color: #c62828; }
.mt-risk-label.veryhigh { background: #b71c1c; color: #ffffff; }
.mt-risk-label.error    { background: #eceff1; color: #455a64; }

@keyframes mt-pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.45; }
}

@media (prefers-reduced-motion: reduce) {
  .mt-risk-label.pending { animation: none; }
  .mt-container { transition: none; }
}

/* Details */
.mt-details {
  border-top: 1px solid #f0e6fa;
  background: #faf7fd;
}

.mt-toggle {
  width: 100%;
  padding: 10px 16px;
  text-align: left;
  background: none;
  border: none;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  color: #7b2cbf;
  cursor: pointer;
}

.mt-toggle:hover {
  color: #5a189a;
}

.mt-details-content {
  padding: 0 16px 14px;
  font-size: 12px;
  max-height: 340px;
  overflow-y: auto;
}

.mt-details-content[hidden] {
  display: none;
}

.mt-signals {
  list-style: none;
  margin: 0 0 10px;
  padding: 0;
}

.mt-signal {
  position: relative;
  margin-bottom: 8px;
  padding-left: 22px;
}

.mt-signal::before {
  content: "\u26A0\uFE0F";
  position: absolute;
  left: 0;
}

.mt-signal.mt-sev-low::before  { content: "\u2705"; }
.mt-signal.mt-sev-info::before { content: "\u2139\uFE0F"; }
.mt-signal.mt-sev-high::before { content: "\u{1F6A8}"; }

.mt-disclaimer {
  margin: 8px 0 0;
  font-size: 10px;
  font-style: italic;
  color: #a07cc5;
}

/* Safety tips */
.mt-section-title {
  margin: 12px 0 6px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  color: #7b2cbf;
}

.mt-tips {
  margin: 0 0 4px;
  padding-left: 18px;
}

.mt-tips li {
  margin-bottom: 5px;
}

.mt-tips-section[hidden],
.mt-feedback[hidden] {
  display: none;
}

/* Feedback */
.mt-feedback-buttons {
  display: flex;
  gap: 8px;
}

.mt-feedback-btn {
  flex: 1;
  padding: 7px 6px;
  background: #ffffff;
  border: 1px solid #d9c2f0;
  border-radius: 8px;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  color: #5a189a;
  cursor: pointer;
}

.mt-feedback-btn:hover:not(:disabled) {
  background: #f3e9fc;
}

.mt-feedback-btn:disabled {
  opacity: 0.55;
  cursor: default;
}

.mt-feedback-status {
  min-height: 14px;
  margin-top: 6px;
  font-size: 11px;
  color: #7b2cbf;
}
`;

  // content/overlay.ts
  function bandFor(score, hasFlags) {
    if (score <= 20) return { band: "low", label: hasFlags ? "Minor flags only" : "No red flags found" };
    if (score <= 40) return { band: "moderate", label: "Moderate risk" };
    if (score <= 60) return { band: "elevated", label: "Elevated risk" };
    if (score <= 80) return { band: "high", label: "High risk" };
    return { band: "veryhigh", label: "Very high risk" };
  }
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== void 0) node.textContent = text;
    return node;
  }
  var Overlay = class {
    host = null;
    card;
    score;
    label;
    signals;
    tipsSection;
    tips;
    feedback;
    feedbackStatus;
    feedbackButtons = [];
    details;
    toggle;
    onFeedback = null;
    /** Shows the card in its "analyzing" state (creating it on first use). */
    showLoading() {
      this.ensureMounted();
      this.card.classList.remove("mt-hidden");
      this.score.textContent = "--";
      this.setLabel("pending", "Analyzing listing...");
      this.signals.replaceChildren(el("li", "mt-signal mt-sev-info", "Reading listing details..."));
      this.clearExtras();
    }
    renderAnalysis(result, onFeedback) {
      this.ensureMounted();
      this.card.classList.remove("mt-hidden");
      const realSignals = result.signals.filter((s) => s.severity > 0);
      const { band, label } = bandFor(result.risk_score, realSignals.length > 0);
      this.score.textContent = String(result.risk_score);
      this.setLabel(band, label);
      if (result.signals.length === 0) {
        this.signals.replaceChildren(
          el("li", "mt-signal mt-sev-low", "No red flags found in the listing text, price or seller profile.")
        );
      } else {
        this.signals.replaceChildren(
          ...result.signals.map((s) => {
            const sev = s.severity === 0 ? "info" : s.severity >= 0.8 ? "high" : "mid";
            return el("li", `mt-signal mt-sev-${sev}`, s.explanation);
          })
        );
      }
      this.tips.replaceChildren(...result.checklist.map((tip) => el("li", void 0, tip)));
      this.tipsSection.hidden = result.checklist.length === 0;
      this.onFeedback = onFeedback;
      this.resetFeedback();
      this.feedback.hidden = false;
      this.setDetailsOpen(result.risk_score > 40);
    }
    renderError(message) {
      this.ensureMounted();
      this.card.classList.remove("mt-hidden");
      this.score.textContent = "--";
      this.setLabel("error", "Unavailable");
      this.signals.replaceChildren(el("li", "mt-signal mt-sev-high", message));
      this.clearExtras();
      this.setDetailsOpen(true);
    }
    hide() {
      this.card?.classList.add("mt-hidden");
    }
    /** Removes the card from the page entirely (used when this script instance is orphaned). */
    destroy() {
      this.host?.remove();
      this.host = null;
    }
    // ---- internals ----
    setLabel(cls, text) {
      this.label.className = `mt-risk-label ${cls}`;
      this.label.textContent = text;
    }
    setDetailsOpen(open) {
      this.details.hidden = !open;
      this.toggle.textContent = open ? "\u25B2 Hide details" : "\u25BC Details & safety tips";
    }
    clearExtras() {
      this.tips.replaceChildren();
      this.tipsSection.hidden = true;
      this.feedback.hidden = true;
      this.onFeedback = null;
    }
    resetFeedback() {
      this.feedbackStatus.textContent = "";
      this.feedbackButtons.forEach((b) => b.disabled = false);
    }
    async submitFeedback(label) {
      if (!this.onFeedback) return;
      this.feedbackButtons.forEach((b) => b.disabled = true);
      this.feedbackStatus.textContent = "Saving...";
      const saved = await this.onFeedback(label);
      if (saved) {
        this.feedbackStatus.textContent = "Thanks, saved.";
      } else {
        this.feedbackStatus.textContent = "Couldn't save. Is the server running?";
        this.feedbackButtons.forEach((b) => b.disabled = false);
      }
    }
    ensureMounted() {
      if (this.host?.isConnected) return;
      if (this.host) {
        document.documentElement.appendChild(this.host);
        return;
      }
      this.host = document.createElement("div");
      this.host.id = "marketrust-root";
      const shadow = this.host.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = overlay_default;
      this.card = el("div", "mt-container");
      this.card.setAttribute("role", "complementary");
      this.card.setAttribute("aria-label", "MarkeTrust listing analysis");
      const header = el("div", "mt-header");
      const brand = el("div", "mt-brand");
      const logo = el("img", "mt-logo");
      logo.alt = "";
      try {
        logo.src = chrome.runtime.getURL("ui/images/icon.svg");
      } catch {
      }
      brand.append(logo, el("span", "mt-title", "MarkeTrust"));
      const close = el("button", "mt-close-btn", "\xD7");
      close.setAttribute("aria-label", "Close");
      close.addEventListener("click", () => this.hide());
      header.append(brand, close);
      const body = el("div", "mt-body");
      const scoreRow = el("div");
      this.score = el("span", "mt-score-value", "--");
      scoreRow.append(this.score, el("span", "mt-score-max", "/100"));
      this.label = el("div", "mt-risk-label pending", "Analyzing listing...");
      body.append(scoreRow, this.label);
      const detailsWrap = el("div", "mt-details");
      this.toggle = el("button", "mt-toggle");
      this.toggle.addEventListener("click", () => this.setDetailsOpen(Boolean(this.details.hidden)));
      this.details = el("div", "mt-details-content");
      this.signals = el("ul", "mt-signals");
      this.tipsSection = el("div", "mt-tips-section");
      this.tips = el("ul", "mt-tips");
      this.tipsSection.append(el("div", "mt-section-title", "Stay safe"), this.tips);
      this.feedback = el("div", "mt-feedback");
      const buttons = el("div", "mt-feedback-buttons");
      this.feedbackButtons = [
        ["legit", "\u2705 Looks legit"],
        ["scam", "\u{1F6A9} It is a scam"]
      ].map(([label, text]) => {
        const btn = el("button", "mt-feedback-btn", text);
        btn.addEventListener("click", () => void this.submitFeedback(label));
        return btn;
      });
      buttons.append(...this.feedbackButtons);
      this.feedbackStatus = el("div", "mt-feedback-status");
      this.feedback.append(el("div", "mt-section-title", "Your verdict (helps improve MarkeTrust)"), buttons, this.feedbackStatus);
      this.details.append(
        this.signals,
        this.tipsSection,
        this.feedback,
        el(
          "p",
          "mt-disclaimer",
          "Checked: listing text, price and seller profile. Not checked: your chat with the seller or the item itself. These are risk signals, not proof that a seller is a scammer, and no flags does not mean safe."
        )
      );
      detailsWrap.append(this.toggle, this.details);
      this.card.append(header, body, detailsWrap);
      shadow.append(style, this.card);
      this.clearExtras();
      this.setDetailsOpen(false);
      document.documentElement.appendChild(this.host);
    }
  };

  // content/route-watcher.ts
  function watchRoute(onChange, onOrphaned) {
    let last = "";
    const check = () => {
      if (!chrome.runtime?.id) {
        cleanup();
        onOrphaned?.();
        return;
      }
      if (location.pathname === last) return;
      last = location.pathname;
      onChange(last);
    };
    const timer = window.setInterval(check, 400);
    window.addEventListener("popstate", check);
    const nav = window.navigation;
    nav?.addEventListener("navigatesuccess", check);
    const cleanup = () => {
      window.clearInterval(timer);
      window.removeEventListener("popstate", check);
      nav?.removeEventListener("navigatesuccess", check);
    };
    check();
    return cleanup;
  }

  // content/content.ts
  var adapter = new FacebookAdapter();
  var overlay = new Overlay();
  var runId = 0;
  var controller = null;
  async function requestAnalysis(request) {
    try {
      const response = await chrome.runtime.sendMessage(request);
      return response ?? { ok: false, error: "No response from the extension background worker." };
    } catch (err) {
      console.error("[MarkeTrust] sendMessage failed", err);
      if (!chrome.runtime?.id) {
        return { ok: false, error: "MarkeTrust was updated. Refresh this tab to continue." };
      }
      const detail = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `Could not reach the MarkeTrust background worker: ${detail}` };
    }
  }
  async function submitFeedback(listing, result, label) {
    const request = {
      type: "SEND_FEEDBACK",
      payload: {
        listing,
        risk_score: result.risk_score,
        signal_types: result.signals.map((s) => s.type),
        label
      }
    };
    try {
      const response = await chrome.runtime.sendMessage(request);
      return Boolean(response?.ok);
    } catch {
      return false;
    }
  }
  async function handleRoute(pathname) {
    controller?.abort();
    controller = new AbortController();
    const { signal } = controller;
    const myRun = ++runId;
    if (!adapter.isListingPath(pathname)) {
      overlay.hide();
      return;
    }
    overlay.showLoading();
    await new Promise((r) => setTimeout(r, 400));
    if (signal.aborted || myRun !== runId) return;
    const raw = await adapter.waitForListing(signal);
    if (signal.aborted || myRun !== runId) return;
    if (!raw) {
      overlay.renderError("Couldn't read this listing. Facebook may still be loading - try reloading the tab.");
      return;
    }
    console.log("[MarkeTrust] extracted", raw);
    const payload = adapter.toPayload(raw);
    const result = await requestAnalysis({ type: "ANALYZE_LISTING", payload });
    if (signal.aborted || myRun !== runId) return;
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
})();
//# sourceMappingURL=content.js.map
