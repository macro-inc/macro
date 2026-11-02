import {
  createClient,
  fetchExchange,
  gql,
  type OperationResult,
} from '@urql/core';
import { describe, expect, it, vi } from 'vitest';
import {
  captureTraceParentExchange,
  TRACE_PARENT_CONTEXT_KEY,
  traceParentExchange,
} from './trace-parent-exchange';

const { active } = vi.hoisted(() => ({ active: [] as string[] }));

vi.mock('@macro-inc/observability', () => ({
  Telemetry: {
    captureContext: () => {
      const captured = active.at(-1);
      return {
        run: <T>(work: () => T): T =>
          captured ? within(captured, work) : work(),
      };
    },
  },
}));

function within<T>(name: string, work: () => T): T {
  active.push(name);
  try {
    return work();
  } finally {
    active.pop();
  }
}

const query = gql`
  query Viewer($first: Int) {
    viewer(first: $first) {
      id
    }
  }
`;

function clientRecording(sentIn: (string | undefined)[]) {
  return createClient({
    url: 'https://example.test/graphql',
    exchanges: [captureTraceParentExchange, traceParentExchange, fetchExchange],
    fetch: async () => {
      sentIn.push(active.at(-1));
      return new Response(JSON.stringify({ data: { viewer: null } }), {
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
}

describe('trace parent exchanges', () => {
  it('sends a request inside the trace its query asked for', async () => {
    const sentIn: (string | undefined)[] = [];
    const client = clientRecording(sentIn);
    const parent = { run: <T>(work: () => T) => within('view.home', work) };

    await client
      .query(query, { first: 1 }, { [TRACE_PARENT_CONTEXT_KEY]: parent })
      .toPromise();
    await client
      .query(query, { first: 2 }, { requestPolicy: 'network-only' })
      .toPromise();

    expect(sentIn).toEqual(['view.home', undefined]);
  });

  it('sends a query in the span it was started in, only for its first request', async () => {
    const sentIn: (string | undefined)[] = [];
    const client = clientRecording(sentIn);
    const results: OperationResult[] = [];
    const subscription = within('crm.contacts', () =>
      client
        .query(query, { first: 3 }, { requestPolicy: 'network-only' })
        .subscribe((result) => results.push(result))
    );
    await vi.waitFor(() => expect(results).toHaveLength(1));
    client.reexecuteOperation(results[0].operation);
    await vi.waitFor(() => expect(sentIn).toHaveLength(2));
    subscription.unsubscribe();

    expect(sentIn).toEqual(['crm.contacts', undefined]);
  });
});
