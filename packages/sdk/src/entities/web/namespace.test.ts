import { describe, expect, test } from 'bun:test';
import type { WebSearchRequest } from '../../../generated/cognition/types.gen';
import type { MacroClient } from '../../utils/client';
import { WebNamespace } from './namespace';

describe('web.search', () => {
  test('sends the query and limits and returns the found pages', async () => {
    const requests: WebSearchRequest[] = [];
    const client = {
      cognition: {
        searchWeb: async ({ body }: { body: WebSearchRequest }) => {
          requests.push(body);
          return {
            data: {
              results: [
                {
                  title: 'Tokio',
                  url: 'https://tokio.rs',
                  pageAge: 'May 1, 2026',
                },
              ],
            },
          };
        },
      },
    } as unknown as MacroClient;

    const pages = await new WebNamespace(client).search('tokio', {
      domains: ['tokio.rs'],
      maxResults: 5,
    });

    expect(requests).toEqual([
      { query: 'tokio', domains: ['tokio.rs'], maxResults: 5 },
    ]);
    expect(pages).toEqual([
      { title: 'Tokio', url: 'https://tokio.rs', pageAge: 'May 1, 2026' },
    ]);
  });
});
