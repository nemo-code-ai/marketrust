import type { AnalyzePayload, RawExtractedListing } from '../shared/types';
import { waitFor } from './wait-for';
import * as dom from './dom-extractor';

const CURRENCY_BY_SYMBOL: Record<string, string> = {
  '₦': 'NGN', NGN: 'NGN',
  $: 'USD', USD: 'USD',
  '£': 'GBP', GBP: 'GBP',
  '€': 'EUR', EUR: 'EUR'
};

export class FacebookAdapter {
  readonly platform = 'facebook';

  isListingPath(pathname = location.pathname): boolean {
    return /\/marketplace\/item\/\d+/.test(pathname);
  }

  extractListingId(): string | null {
    return location.pathname.match(/\/marketplace\/item\/(\d+)/)?.[1] ?? null;
  }

  extractListing(): RawExtractedListing {
    const root = dom.getListingRoot();
    const id = this.extractListingId();
    const title = dom.extractTitle(root);
    const seller = dom.extractSeller(root);

    return {
      platform: this.platform,
      listingId: { value: id, confidence: id ? 1 : 0, source: 'url-path' },
      title,
      price: dom.extractPrice(root),
      originalPrice: dom.extractOriginalPrice(root),
      description: dom.extractDescription(root, title.value),
      sellerName: seller.name,
      sellerProfileUrl: seller.profileUrl,
      sellerJoinedYear: dom.extractSellerJoinedYear(root),
      location: dom.extractLocation(root),
      imageUrls: dom.extractImages(root),
      extractedAt: new Date().toISOString()
    };
  }

  /**
   * Waits for Facebook to finish rendering: resolves once the core fields exist,
   * or after the timeout with whatever we managed to read (if we at least have a title).
   */
  async waitForListing(signal: AbortSignal): Promise<RawExtractedListing | null> {
    const ready = await waitFor(
      () => {
        const l = this.extractListing();
        return l.title.value && l.price.value && l.sellerProfileUrl.value ? l : null;
      },
      { signal, timeoutMs: 8000 }
    );
    if (ready) return ready;
    if (signal.aborted) return null;

    const partial = this.extractListing();
    return partial.title.value ? partial : null;
  }

  private parsePrice(text: string | null): { amount: number | null; currency: string | null } {
    const match = text?.match(/^(\D+?)\s?([\d][\d.,]*)$/);
    if (!match) return { amount: null, currency: null };
    const symbol = match[1];
    const amount = parseFloat(match[2].replace(/,/g, ''));
    return {
      amount: Number.isFinite(amount) ? amount : null,
      currency: CURRENCY_BY_SYMBOL[symbol.toUpperCase()] ?? CURRENCY_BY_SYMBOL[symbol] ?? null
    };
  }

  toPayload(raw: RawExtractedListing): AnalyzePayload {
    const price = this.parsePrice(raw.price.value);
    const original = this.parsePrice(raw.originalPrice.value);

    // How much of the core listing we actually managed to read (0-1); lets the backend flag partial reads.
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
}
