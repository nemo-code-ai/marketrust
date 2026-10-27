"use strict";
(() => {
  // background/service-worker.ts
  var API_BASE = "http://127.0.0.1:8000/api/v1";
  var TIMEOUT_MS = 1e4;
  async function post(path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      if (!res.ok) return { ok: false, error: `MarkeTrust server returned HTTP ${res.status}.` };
      return { ok: true, data: await res.json() };
    } catch (err) {
      const timedOut = err instanceof DOMException && err.name === "AbortError";
      return {
        ok: false,
        error: timedOut ? "The MarkeTrust server took too long to respond." : "Could not reach the MarkeTrust server. Is it running on http://127.0.0.1:8000?"
      };
    } finally {
      clearTimeout(timer);
    }
  }
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return false;
    switch (message?.type) {
      case "ANALYZE_LISTING":
        post("/analyze", message.payload).then(sendResponse);
        return true;
      // keep the channel open for the async response
      case "SEND_FEEDBACK":
        post("/feedback", message.payload).then(sendResponse);
        return true;
      default:
        return false;
    }
  });
})();
//# sourceMappingURL=service-worker.js.map
