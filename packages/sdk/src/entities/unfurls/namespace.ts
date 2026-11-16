import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';

/**
 * URL metadata lookup.
 *
 * @routing Use when reading a URL's preview metadata; not fetching or searching the web.
 */
export class UnfurlNamespace {
  constructor(private readonly client: MacroClient) {}

  /**
   * Read title, description and preview metadata for a URL.
   *
   * @readonly
   * @openworld
   */
  async get(url: string) {
    return unwrap(await this.client.unfurl.getUnfurl({ query: { url } }));
  }

  /**
   * Read metadata for multiple URLs in one request.
   *
   * @readonly
   * @openworld
   */
  async bulk(urls: string[]) {
    return unwrap(
      await this.client.unfurl.getUnfurlBulk({ body: { url_list: urls } }),
    );
  }
}
