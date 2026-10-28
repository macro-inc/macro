import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';

/** URL metadata lookup. */
export class UnfurlNamespace {
  constructor(private readonly client: MacroClient) {}

  /** Read title, description and preview metadata for a URL. */
  async get(url: string) {
    return unwrap(await this.client.unfurl.getUnfurl({ query: { url } }));
  }

  /** Read metadata for multiple URLs in one request. */
  async bulk(urls: string[]) {
    return unwrap(
      await this.client.unfurl.getUnfurlBulk({ body: { url_list: urls } }),
    );
  }
}
