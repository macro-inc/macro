import type {
  WebFetchResponse,
  WebSearchResult,
  WebSearchTopic,
} from '../../../generated/cognition/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';

export type { WebFetchResponse, WebSearchResult, WebSearchTopic };

/** Filters for {@link WebNamespace.search}. */
export interface WebSearchOptions {
  /** Only return pages from these domains, e.g. `['docs.rs', 'github.com']`. */
  domains?: string[];
  /** Never return pages from these domains. */
  excludeDomains?: string[];
  /** Only return pages published on or after this date, as `YYYY-MM-DD`. */
  since?: string;
  /** `news` for recent articles with publication dates; `general` (the default) otherwise. */
  topic?: WebSearchTopic;
  /** How many results to return, 1 to 20. Defaults to 5. */
  maxResults?: number;
  /** Also return each page's text as Markdown, up to 8,000 characters per result. */
  includeContent?: boolean;
}

/** Options for {@link WebNamespace.fetch}. */
export interface WebFetchOptions {
  /** Most characters of page text to return, 1 to 100,000. Defaults to 20,000. */
  maxChars?: number;
}

/**
 * Search the public web and read web pages, charged to the acting user's AI
 * allowance.
 *
 * @routing Use when finding or reading information on the public internet; not searching the user's Macro workspace (`macro.search`) or reading a URL's preview card (`macro.unfurls`).
 *
 * @agent Search returns snippets, which often answer the question on their
 * own; fetch a result's URL only when you need the whole page. Cite the URL of
 * every page you rely on. Pages behind a login, or rendered only by
 * JavaScript, may fail to fetch with `fetch_failed`.
 */
export class WebNamespace {
  constructor(private readonly client: MacroClient) {}

  /**
   * Search the public web; returns title, URL and a query-relevant snippet per
   * page, best match first. Cite the URLs you use.
   *
   * @example
   * const { results } = await macro.web.search('Tokio 1.48 release notes', {
   *   domains: ['tokio.rs'],
   *   maxResults: 3,
   * });
   * for (const result of results) console.log(result.title, result.url, result.snippet);
   *
   * @write
   * @openworld
   */
  async search(
    query: string,
    options: WebSearchOptions = {},
  ): Promise<{ results: WebSearchResult[] }> {
    return unwrap(
      await this.client.cognition.searchWeb({
        body: {
          query,
          domains: options.domains,
          excludeDomains: options.excludeDomains,
          since: options.since,
          topic: options.topic,
          maxResults: options.maxResults,
          includeContent: options.includeContent,
        },
      }),
    );
  }

  /**
   * Read one public web page as Markdown, cut to `maxChars` (`truncated` says
   * whether it was). Use it when a search snippet is not enough; cite the URL.
   *
   * @example
   * const page = await macro.web.fetch('https://tokio.rs/blog/2025-10-tokio-1-48');
   * console.log(page.content);
   *
   * @write
   * @openworld
   */
  async fetch(
    url: string,
    options: WebFetchOptions = {},
  ): Promise<WebFetchResponse> {
    return unwrap(
      await this.client.cognition.fetchWebPage({
        body: { url, maxChars: options.maxChars },
      }),
    );
  }
}
