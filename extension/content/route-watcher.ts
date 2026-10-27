/**
 * Facebook is a SPA: clicking a listing changes the URL with history.pushState
 * and never reloads the page. Content scripts live in an isolated world, so we
 * can't hook the page's pushState; instead we combine three cheap signals.
 * onChange fires once for the initial route and again whenever the PATH changes
 * (query-string churn like ?ref=... is ignored).
 */
export function watchRoute(
  onChange: (pathname: string) => void,
  onOrphaned?: () => void
): () => void {
  let last = '';

  const check = () => {
    // After the extension is reloaded, this old script keeps running but can no longer
    // talk to the extension. Detect that and shut down instead of piling up duplicates.
    if (!chrome.runtime?.id) {
      cleanup();
      onOrphaned?.();
      return;
    }
    if (location.pathname === last) return;
    last = location.pathname;
    onChange(last);
  };

  const timer = window.setInterval(check, 400); // bulletproof fallback
  window.addEventListener('popstate', check);

  // Navigation API (Chrome 102+): fires immediately on pushState/replaceState.
  const nav = (window as unknown as { navigation?: EventTarget }).navigation;
  nav?.addEventListener('navigatesuccess', check);

  const cleanup = () => {
    window.clearInterval(timer);
    window.removeEventListener('popstate', check);
    nav?.removeEventListener('navigatesuccess', check);
  };

  check(); // initial route

  return cleanup;
}
