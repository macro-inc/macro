/** Keep bundled assets in the webview; native HTTP only supports HTTP(S). */
export function createTauriFetch(
  browserFetch: typeof fetch,
  nativeFetch: typeof fetch,
  baseUrl: () => string
): typeof fetch {
  return new Proxy(browserFetch, {
    async apply(target, thisArg, args: Parameters<typeof fetch>) {
      const input = args[0];
      const url = new URL(
        input instanceof Request ? input.url : String(input),
        baseUrl()
      );
      const useBrowser =
        !['http:', 'https:'].includes(url.protocol) ||
        url.hostname === 'localhost' ||
        url.hostname.endsWith('.localhost') ||
        url.hostname === '127.0.0.1' ||
        url.hostname === '[::1]';
      return Reflect.apply(useBrowser ? target : nativeFetch, thisArg, args);
    },
  });
}
