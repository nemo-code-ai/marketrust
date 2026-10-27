"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MarketplaceDetector = void 0;
class MarketplaceDetector {
    static isFacebookMarketplaceItemPage() {
        return window.location.pathname.includes('/marketplace/item/');
    }
}
exports.MarketplaceDetector = MarketplaceDetector;
