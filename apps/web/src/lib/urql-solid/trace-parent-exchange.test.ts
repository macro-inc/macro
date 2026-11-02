import { createClient, fetchExchange, gql } from '@urql/core';
import { describe, expect, it } from 'vitest';
import {
  TRACE_PARENT_CONTEXT_KEY,
  traceParentExchange,
} from './trace-parent-exchange';

const query = gql`
  query Viewer {
    viewer {
      id
    }
  }
`;

describe('traceParentExchange', () => {
  it('sends a request inside the trace its query asked for', async () => {
    const active: string[] = [];
    const sentIn: (string | undefined)[] = [];
    const client = createClient({
      url: 'https://example.test/graphql',
      exchanges: [traceParentExchange, fetchExchange],
      fetch: async () => {
        sentIn.push(active.at(-1));
        return new Response(JSON.stringify({ data: { viewer: null } }), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });
    const parent = {
      run<T>(work: () => T): T {
        active.push('view.home');
        try {
          return work();
        } finally {
          active.pop();
        }
      },
    };

    await client
      .query(query, {}, { [TRACE_PARENT_CONTEXT_KEY]: parent })
      .toPromise();
    await client
      .query(query, {}, { requestPolicy: 'network-only' })
      .toPromise();

    expect(sentIn).toEqual(['view.home', undefined]);
  });
});
