interface WaitOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Debounce for DOM mutation bursts (Facebook mutates constantly). */
  debounceMs?: number;
}

/**
 * Resolves as soon as `probe()` returns a truthy value, re-checking whenever
 * the DOM changes. Resolves null on timeout or abort. Never throws.
 */
export function waitFor<T>(
  probe: () => T | null | undefined | false,
  { timeoutMs = 8000, signal, debounceMs = 150 }: WaitOptions = {}
): Promise<T | null> {
  return new Promise((resolve) => {
    let finished = false;
    let debounce: number | undefined;

    const observer = new MutationObserver(() => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(check, debounceMs);
    });

    const finish = (value: T | null) => {
      if (finished) return;
      finished = true;
      observer.disconnect();
      window.clearTimeout(debounce);
      window.clearTimeout(timeout);
      window.clearInterval(interval);
      signal?.removeEventListener('abort', onAbort);
      resolve(value);
    };

    const check = () => {
      const value = probe();
      if (value) finish(value);
    };

    const onAbort = () => finish(null);

    // Safety net in case a change doesn't trigger a mutation we observe.
    const interval = window.setInterval(check, 500);
    const timeout = window.setTimeout(() => finish(null), timeoutMs);

    if (signal?.aborted) return finish(null);
    signal?.addEventListener('abort', onAbort);

    observer.observe(document.documentElement, { childList: true, subtree: true });
    check();
  });
}
