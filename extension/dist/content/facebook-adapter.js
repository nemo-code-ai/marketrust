"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FacebookAdapter = void 0;
const dom_extractor_1 = require("./dom-extractor");
class FacebookAdapter {
    platform = 'facebook';
    extractListingId() {
        const match = window.location.pathname.match(/\/marketplace\/item\/(\d+)/);
        return match ? match[1] : null;
    }
    extractListing() {
        const listingId = this.extractListingId();
        const seller = dom_extractor_1.DomExtractor.extractSeller();
        return {
            platform: this.platform,
            listingId: {
                value: listingId,
                confidence: listingId ? 1.0 : 0.0,
                source: 'url-path'
            },
            title: dom_extractor_1.DomExtractor.extractTitle(),
            price: dom_extractor_1.DomExtractor.extractPrice(),
            description: dom_extractor_1.DomExtractor.extractDescription(),
            sellerName: seller.name,
            sellerProfileUrl: seller.profileUrl,
            location: { value: null, confidence: 0.0, source: 'placeholder' },
            imageUrls: dom_extractor_1.DomExtractor.extractImages(),
            extractedAt: new Date().toISOString()
        };
    }
}
exports.FacebookAdapter = FacebookAdapter;
