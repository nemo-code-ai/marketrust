import type { ConfidenceValue } from '../shared/types';

/**
 * Extraction rules of thumb (Facebook randomizes class names, so we never use them):
 *   1. Anchor on things Facebook can't easily change: URLs, ARIA roles, headings,
 *      `dir="auto"` text containers, and the *shape* of the text (price regex).
 *   2. Scope every query to the listing's own container, so prices/links from the
 *      feed behind an item modal are never picked up.
 *   3. Every field returns a confidence + the strategy that produced it.
 */

const none = <T>(): ConfidenceValue<T> => ({ value: null, confidence: 0, source: 'none' });
const found = <T>(value: T, confidence: number, source: string): ConfidenceValue<T> => ({
  value,
  confidence,
  source
});

const SELLER_LINK_SELECTOR =
  'a[href*="/marketplace/profile/"], a[href*="/profile.php"], a[href*="/user/"]';

const PRICE_RE = /^(₦|NGN|\$|USD|£|GBP|€|EUR)\s?([\d][\d.,]*)$/i;
const GENERIC_TITLES = /^(marketplace|notifications|facebook|search results?)$/i;

const clean = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();
const textOf = (el: Element): string =>
  (el as HTMLElement).innerText ?? el.textContent ?? '';

function currentListingId(): string | null {
  return location.pathname.match(/\/marketplace\/item\/(\d+)/)?.[1] ?? null;
}

/** Meta tags are NOT updated on SPA navigation, so only trust them if og:url matches this listing. */
function freshMeta(property: string): string | null {
  const id = currentListingId();
  const ogUrl = document.querySelector('meta[property="og:url"]')?.getAttribute('content') ?? '';
  if (!id || !ogUrl.includes(id)) return null;
  return clean(document.querySelector(`meta[property="${property}"]`)?.getAttribute('content')) || null;
}

/** Facebook UI panels (Notifications, chats...) are also role="dialog"; skip them. */
function isFacebookChrome(el: Element): boolean {
  const heading = el.querySelector('h1, h2');
  return Boolean(heading && GENERIC_TITLES.test(clean(textOf(heading))));
}

/** The subtree that holds THIS listing (modal dialog, main region, or body as a last resort). */
export function getListingRoot(): Element {
  const candidates: Element[] = [
    ...document.querySelectorAll('[role="dialog"]'),
    ...document.querySelectorAll('[role="main"], main')
  ].filter((c) => !isFacebookChrome(c));

  return (
    candidates.find((c) => c.querySelector(SELLER_LINK_SELECTOR)) ??
    candidates.find((c) => findTitleElement(c)) ??
    document.body
  );
}

function findTitleElement(root: Element): HTMLElement | null {
  for (const h1 of root.querySelectorAll<HTMLElement>('h1')) {
    const text = clean(textOf(h1));
    if (text.length >= 2 && text.length <= 200 && !GENERIC_TITLES.test(text)) return h1;
  }
  return null;
}

export function extractTitle(root: Element): ConfidenceValue<string> {
  const h1 = findTitleElement(root);
  if (h1) return found(clean(textOf(h1)), 0.9, 'heading');

  const og = freshMeta('og:title');
  if (og) return found(og, 0.8, 'og:title (verified fresh)');

  const fromTab = clean(
    document.title
      .replace(/^\(\d+\)\s*/, '')
      .replace(/\s*\|\s*Facebook$/i, '')
      .replace(/^Marketplace\s*[-–—]\s*/i, '')
  );
  if (fromTab && !GENERIC_TITLES.test(fromTab)) return found(fromTab, 0.5, 'document.title');

  return none();
}

function isPriceLeaf(el: Element): boolean {
  if (el.children.length > 0) return false;
  const text = clean(el.textContent);
  return text.length <= 20 && PRICE_RE.test(text);
}

function parseAmount(text: string): number | null {
  const m = PRICE_RE.exec(text);
  return m ? parseFloat(m[2].replace(/,/g, '')) : null;
}

function findPriceElement(root: Element): { el: Element; afterTitle: boolean } | null {
  const titleEl = findTitleElement(root);
  let fallback: { el: Element; afterTitle: boolean } | null = null;

  for (const el of root.querySelectorAll('span, div, h2')) {
    if (!isPriceLeaf(el)) continue;
    const afterTitle = titleEl
      ? Boolean(titleEl.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)
      : true;
    if (afterTitle) return { el, afterTitle: true };
    fallback ??= { el, afterTitle: false };
  }
  return fallback;
}

export function extractPrice(root: Element): ConfidenceValue<string> {
  const hit = findPriceElement(root);
  if (!hit) return none();
  const text = clean(hit.el.textContent);
  return hit.afterTitle
    ? found(text, 0.85, 'price-shaped text after title')
    : found(text, 0.5, 'price-shaped text');
}

/** The struck-through "was" price sits right next to the current price, never elsewhere on the page. */
export function extractOriginalPrice(root: Element): ConfidenceValue<string> {
  const hit = findPriceElement(root);
  if (!hit?.afterTitle) return none();
  const current = parseAmount(clean(hit.el.textContent));
  if (current === null) return none();

  let box: Element | null = hit.el.parentElement;
  for (let i = 0; box && i < 3; i++, box = box.parentElement) {
    if (clean(box.textContent).length > 60) break; // too big: would include other listings
    for (const other of box.querySelectorAll('span, div')) {
      if (other === hit.el || !isPriceLeaf(other)) continue;
      const text = clean(other.textContent);
      const amount = parseAmount(text);
      if (amount !== null && amount > current) {
        return found(text, 0.7, 'higher price beside current price');
      }
    }
  }
  return none();
}

export function extractSellerJoinedYear(root: Element): ConfidenceValue<number> {
  for (const el of root.querySelectorAll('[dir="auto"]')) {
    const text = clean(textOf(el));
    if (text.length > 60) continue;
    const year = text.match(/\bJoined Facebook\b.*?\b((?:19|20)\d{2})\b/i)?.[1];
    if (year) return found(Number(year), 0.85, '"Joined Facebook in <year>" text');
  }
  return none();
}

const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
const PRECEDING = Node.DOCUMENT_POSITION_PRECEDING;
const CONDITION_VALUE_RE = /^(new|used)\b/i;

/** Text blocks between the "Details" heading and the next heading ("Seller information"). */
function detailsBlocks(root: Element): Element[] | null {
  const headings = [...root.querySelectorAll('h2')];
  const start = headings.find((h) => /^details$/i.test(clean(textOf(h))));
  if (!start) return null;
  const end = headings.find((h) => h !== start && start.compareDocumentPosition(h) & FOLLOWING);

  return [...root.querySelectorAll('[dir="auto"]')].filter((el) => {
    if (el.closest('h1, h2, h3')) return false;
    if (!(start.compareDocumentPosition(el) & FOLLOWING)) return false;
    if (end && !(end.compareDocumentPosition(el) & PRECEDING)) return false;
    return true;
  });
}

export function extractDescription(root: Element, title: string | null): ConfidenceValue<string> {
  const place = extractLocation(root).value;

  // Strip lines that are metadata, not the seller's own words.
  const isMetadata = (t: string): boolean =>
    t === title ||
    /^Listed\b/i.test(t) ||
    /approximate/i.test(t) ||
    /^condition$/i.test(t) ||
    (CONDITION_VALUE_RE.test(t) && t.length <= 25) ||
    Boolean(place && t.startsWith(place));

  const pick = (blocks: Element[]): string => {
    let best = '';
    for (const el of blocks) {
      if (el.closest('a, button')) continue;
      const text = clean(textOf(el));
      if (text.length < 8 || text.length > 5000 || isMetadata(text)) continue;
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
  if (generic) return found(generic, 0.5, 'longest dir=auto block (fallback)');

  const og = freshMeta('og:description');
  if (og && og.length > 10) return found(og, 0.6, 'og:description (verified fresh)');

  return none();
}

function normalizeProfileUrl(href: string): string {
  try {
    const u = new URL(href);
    return u.origin + u.pathname + (u.pathname.endsWith('profile.php') ? u.search : '');
  } catch {
    return href;
  }
}

export function extractSeller(root: Element): {
  name: ConfidenceValue<string>;
  profileUrl: ConfidenceValue<string>;
} {
  let firstUrl: string | null = null;

  for (const link of root.querySelectorAll<HTMLAnchorElement>(SELLER_LINK_SELECTOR)) {
    const url = normalizeProfileUrl(link.href);
    firstUrl ??= url;

    const name = clean(link.textContent) || clean(link.getAttribute('aria-label'));
    if (name.length < 2 || /seller details|message|see all/i.test(name)) continue;

    return {
      name: found(name, 0.85, 'seller link text'),
      profileUrl: found(url, 0.9, 'seller link href')
    };
  }

  // Profile link exists but we couldn't read a name (e.g. avatar-only link).
  if (firstUrl) {
    return { name: none(), profileUrl: found(firstUrl, 0.7, 'seller link href (no name)') };
  }
  return { name: none(), profileUrl: none() };
}

export function extractLocation(root: Element): ConfidenceValue<string> {
  // Strongest anchor: the city link, e.g. /marketplace/106265246077413/ with text "Lagos, Surulere".
  for (const a of root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    let path = '';
    try {
      path = new URL(a.href).pathname;
    } catch {
      continue;
    }
    if (!/^\/marketplace\/\d+\/?$/.test(path)) continue;
    const text = clean(a.textContent);
    if (text.length >= 2 && text.length <= 80) return found(text, 0.85, 'city link');
  }

  // Fallback: the "Listed 5 days ago in <place>" line.
  for (const el of root.querySelectorAll('[dir="auto"]')) {
    const text = clean(textOf(el));
    if (text.length > 120 || !/^Listed\b/i.test(text)) continue;
    const place = text.match(/\bin\s+(.+)$/i)?.[1];
    if (place) return found(clean(place), 0.6, '"Listed ... in <place>" text');
  }
  return none();
}

export function extractImages(root: Element): ConfidenceValue<string[]> {
  const urls = new Set<string>();
  for (const img of root.querySelectorAll<HTMLImageElement>('img')) {
    const src = img.currentSrc || img.src;
    const size = Math.max(img.naturalWidth, img.width);
    if (src && /scontent|fbcdn/.test(src) && size >= 200) urls.add(src);
    if (urls.size >= 6) break;
  }
  return urls.size ? found([...urls], 0.8, 'fbcdn images') : found([], 0, 'none');
}
