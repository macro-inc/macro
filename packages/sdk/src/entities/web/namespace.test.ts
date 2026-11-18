import { describe, expect, test } from 'bun:test';
import type {
  WebFetch,
  WebSearch,
} from '../../../generated/cognition/types.gen';
import type { MacroClient } from '../../utils/client';
import { WebNamespace } from './namespace';

describe('web', () => {
  test('search sends the query with its filters and returns the results', async () => {
    const requests: WebSearch[] = [];
    const client = {
      cognition: {
        searchWeb: async ({ body }: { body: WebSearch }) => {
          requests.push(body);
          return {
            data: {
              results: [
                {
                  title: 'Announcing Tokio 1.48',
                  url: 'https://tokio.rs/blog/2025-10-tokio-1-48',
                  snippet: 'Tokio 1.48 ships a faster scheduler.',
                  publishedAt: 'Tue, 14 Oct 2025 09:00:00 GMT',
                },
              ],
            },
          };
        },
      },
    } as unknown as MacroClient;

    const found = await new WebNamespace(client).search('tokio release', {
      domains: ['tokio.rs'],
      since: '2025-10-01',
      topic: 'news',
      maxResults: 3,
    });

    expect(requests).toEqual([
      {
        query: 'tokio release',
        domains: ['tokio.rs'],
        excludeDomains: undefined,
        since: '2025-10-01',
        topic: 'news',
        maxResults: 3,
        includeContent: undefined,
      },
    ]);
    expect(found).toEqual({
      results: [
        {
          title: 'Announcing Tokio 1.48',
          url: 'https://tokio.rs/blog/2025-10-tokio-1-48',
          snippet: 'Tokio 1.48 ships a faster scheduler.',
          publishedAt: 'Tue, 14 Oct 2025 09:00:00 GMT',
        },
      ],
    });
  });

  test('fetch reads one page with a length cap', async () => {
    const requests: WebFetch[] = [];
    const client = {
      cognition: {
        fetchWebPage: async ({ body }: { body: WebFetch }) => {
          requests.push(body);
          return {
            data: {
              url: 'https://example.com/',
              content: '# Example',
              truncated: false,
            },
          };
        },
      },
    } as unknown as MacroClient;

    const page = await new WebNamespace(client).fetch('https://example.com/', {
      maxChars: 500,
    });

    expect(requests).toEqual([{ url: 'https://example.com/', maxChars: 500 }]);
    expect(page).toEqual({
      url: 'https://example.com/',
      content: '# Example',
      truncated: false,
    });
  });

  test('fetch surfaces an unreadable page as an error', async () => {
    const client = {
      cognition: {
        fetchWebPage: async () => ({
          error: {
            error: 'The page could not be read: Failed to retrieve content',
            code: 'fetch_failed',
          },
          response: new Response(null, { status: 422 }),
        }),
      },
    } as unknown as MacroClient;

    await expect(
      new WebNamespace(client).fetch('https://example.com/members-only'),
    ).rejects.toThrow();
  });
});
