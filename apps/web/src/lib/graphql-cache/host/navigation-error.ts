/** Expected cancellation when a page releases its cache transport for navigation. */
export class CacheNavigationError extends Error {
  constructor() {
    super('cache worker host was disposed for page navigation');
    this.name = 'CacheNavigationError';
  }
}
