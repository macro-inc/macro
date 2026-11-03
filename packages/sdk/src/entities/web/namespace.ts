import type { WebSearchResult } from '../../../generated/cognition/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';

export type { WebSearchResult };

/** Limits for a web search. */
export interface WebSearchOptions {
  /**
   * Only return pages from these domains, such as `['docs.rs']`; subdomains
   * match too. At most 20. Omit to search the whole web.
   */
  domains?: string[];
  /** Return at most this many results, from 1 to 30 (the default). */
  maxResults?: number;
}

/** Web search, charged to the acting user's AI allowance. */
export class WebNamespace {
  constructor(private readonly client: MacroClient) {}

  /**
   * Search the web and return the pages found (title, url, and pageAge when
   * known), most relevant first. Results carry no page text: read a page's
   * preview with `macro.unfurls.get(url)`. Takes a few seconds, so run
   * independent searches with `Promise.all`.
   *
   * @example
   * const pages = await macro.web.search('tokio 1.40 release notes', {
   *   domains: ['tokio.rs', 'github.com'],
   *   maxResults: 5,
   * });
   * return pages.map((page) => `${page.title}: ${page.url}`);
   */
  async search(
    query: string,
    options: WebSearchOptions = {},
  ): Promise<WebSearchResult[]> {
    const { results } = unwrap(
      await this.client.cognition.searchWeb({
        body: {
          query,
          domains: options.domains,
          maxResults: options.maxResults ?? null,
        },
      }),
    );
    return results;
  }
}
