"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DomExtractor = void 0;
class DomExtractor {
    static extractTitle() {
        const metaOgTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content');
        if (metaOgTitle) {
            return { value: metaOgTitle.trim(), confidence: 0.95, source: 'meta[property="og:title"]' };
        }
        const h1 = document.querySelector('main h1, [role="main"] h1');
        if (h1 && h1.textContent) {
            return { value: h1.textContent.trim(), confidence: 0.85, source: 'main h1' };
        }
        if (document.title) {
            const cleanTitle = document.title.replace(/\| Facebook$/i, '').trim();
            return { value: cleanTitle, confidence: 0.60, source: 'document.title' };
        }
        return { value: null, confidence: 0.0, source: 'none' };
    }
    static extractPrice() {
        const currencyRegex = /([$€£₦]\s?[\d,]+(\.\d{2})?)/;
        const main = document.querySelector('main, [role="main"]') || document.body;
        const spans = Array.from(main.querySelectorAll('span, div, h2'));
        for (const el of spans) {
            const text = el.textContent?.trim() || '';
            if (currencyRegex.test(text) && text.length < 30) {
                const match = text.match(currencyRegex);
                if (match) {
                    return { value: match[1], confidence: 0.85, source: 'regex-text-node' };
                }
            }
        }
        const metaDesc = document.querySelector('meta[property="og:description"]')?.getAttribute('content');
        if (metaDesc) {
            const match = metaDesc.match(currencyRegex);
            if (match) {
                return { value: match[1], confidence: 0.75, source: 'meta-description-regex' };
            }
        }
        return { value: null, confidence: 0.0, source: 'none' };
    }
    static extractDescription() {
        const metaDesc = document.querySelector('meta[property="og:description"]')?.getAttribute('content');
        if (metaDesc && metaDesc.length > 10) {
            return { value: metaDesc.trim(), confidence: 0.80, source: 'meta[property="og:description"]' };
        }
        const main = document.querySelector('main, [role="main"]');
        if (main) {
            const textNodes = Array.from(main.querySelectorAll('span, div, p'))
                .map(el => el.textContent?.trim() || '')
                .filter(text => text.length > 50 && !text.includes('Facebook') && !text.includes('Marketplace'));
            if (textNodes.length > 0) {
                const longest = textNodes.reduce((a, b) => a.length > b.length ? a : b);
                return { value: longest, confidence: 0.70, source: 'dom-text-block' };
            }
        }
        return { value: null, confidence: 0.0, source: 'none' };
    }
    static extractSeller() {
        const links = Array.from(document.querySelectorAll('a[href*="/user/"], a[href*="/profile.php"]'));
        for (const link of links) {
            const href = link.href;
            const text = link.textContent?.trim();
            if (text && text.length > 1 && !text.toLowerCase().includes('seller details')) {
                return {
                    name: { value: text, confidence: 0.85, source: 'seller-anchor-text' },
                    profileUrl: { value: href, confidence: 0.90, source: 'seller-anchor-href' }
                };
            }
        }
        return {
            name: { value: null, confidence: 0.0, source: 'none' },
            profileUrl: { value: null, confidence: 0.0, source: 'none' }
        };
    }
    static extractImages() {
        const images = [];
        const imgElements = Array.from(document.querySelectorAll('main img, [role="main"] img'));
        for (const img of imgElements) {
            const src = img.src;
            if (src && (src.includes('scontent') || src.includes('fbcdn')) && img.width > 200 && img.height > 200) {
                images.push(src);
            }
        }
        if (images.length > 0) {
            return { value: Array.from(new Set(images)), confidence: 0.85, source: 'dom-img-elements' };
        }
        return { value: [], confidence: 0.0, source: 'none' };
    }
}
exports.DomExtractor = DomExtractor;
