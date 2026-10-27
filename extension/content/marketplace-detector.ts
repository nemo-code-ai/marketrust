export class MarketplaceDetector {
  static isFacebookMarketplaceItemPage(): boolean {
    return window.location.pathname.includes('/marketplace/item/');
  }
}