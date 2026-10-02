import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import {
  CombinedError,
  createClient,
  type Exchange,
  gql,
  type Operation,
  type OperationResult,
  stringifyDocument,
} from '@urql/core';
import { createRoot, For } from 'solid-js';
import { render } from 'solid-js/web';
import { empty, filter, makeSubject, merge, mergeMap, pipe, tap } from 'wonka';
import { createSoupRowStore } from '../../../../features/soup/collection/row-store';
import { soupOptimisticResolvers } from '../../../queries/optimistic-resolvers';
import { setGraphqlEmailThreadArchived } from '../../../service-clients/service-storage/graphql-email-archive-state';
import {
  markGraphqlEmailThreadSeen,
  markGraphqlEmailThreadUnread,
} from '../../../service-clients/service-storage/graphql-email-read-state';
import { normalizedCacheExchange } from '../../exchange/normalized-cache-exchange';
import { optimisticContextOf } from '../../exchange/optimistic';
import { optimisticResolversExchange } from '../../exchange/optimistic-resolvers';
import { createWorkerCacheHost } from '../../host/worker-host';
import { createQuerySignal } from '../../solid/create-query-signal';

type Item = {
  __typename: 'GraphqlSoupEmailThread';
  id: string;
  name: string;
  isRead: boolean;
  inboxVisible: boolean;
};
type Data = { user: { id: string; soup: { items: Item[] } } };
const document = gql`query OptimisticInterfaceRows {
  user { id soup(input: { initial: { limit: 1000 } }) { items {
    __typename id ... on GraphqlSoupEmailThread { name isRead inboxVisible }
  } } }
}` as TypedDocumentNode<Data, Record<string, never>>;
const rows: Item[] = Array.from({ length: 1000 }, (_, index) => ({
  __typename: 'GraphqlSoupEmailThread',
  id: `00000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`,
  name: `Thread ${index + 1}`,
  isRead: false,
  inboxVisible: true,
}));
const host = createWorkerCacheHost({
  scope: crypto.randomUUID(),
  requestTimeoutMs: 30_000,
});
const replies = makeSubject<OperationResult>();
const pending: Operation[] = [];
const results: string[] = [];
const errors: string[] = [];
const counts = { mounts: 0, name: 0, isRead: 0, inboxVisible: 0 };
const fieldCounts = new Map<
  string,
  { name: number; isRead: number; inboxVisible: number }
>();
const network: Exchange = () => (operations) =>
  merge([
    replies.source,
    pipe(
      operations,
      filter((operation) => operation.kind !== 'teardown'),
      tap((operation) => {
        if (operation.kind === 'mutation') pending.push(operation);
        else errors.push(`Unexpected network query ${operation.key}`);
      }),
      mergeMap(() => empty)
    ),
  ]);
const client = createClient({
  url: 'http://unused.invalid/graphql',
  exchanges: [
    optimisticResolversExchange(soupOptimisticResolvers),
    normalizedCacheExchange(host, {
      shouldRetryMutation: (error) => Boolean(error.networkError),
      onCacheError: (error) => errors.push(String(error)),
    }),
    network,
  ],
});

async function submit(action: 'seen' | 'unread' | 'archive' | 'undo') {
  const index = results.push('pending') - 1;
  try {
    results[index] =
      action === 'seen'
        ? await markGraphqlEmailThreadSeen(client, rows[0].id)
        : action === 'unread'
          ? await markGraphqlEmailThreadUnread(client, rows[0].id)
          : await setGraphqlEmailThreadArchived(
              client,
              rows[0].id,
              action === 'archive'
            );
  } catch {
    results[index] = 'failed';
  }
}
function Row(props: { row: Item }) {
  counts.mounts++;
  const local = { name: 0, isRead: 0, inboxVisible: 0 };
  fieldCounts.set(props.row.id, local);
  const field = <K extends keyof typeof local>(key: K) => {
    counts[key]++;
    local[key]++;
    return String(props.row[key]);
  };
  return (
    <div data-row={props.row.id}>
      <span data-field="name">{field('name')}</span>
      <span data-field="read">{field('isRead')}</span>
      <span data-field="inbox">{field('inboxVisible')}</span>
    </div>
  );
}

declare global {
  interface Window {
    optimisticInterface: {
      snapshot: () => {
        counts: typeof counts;
        first: typeof counts | object;
        last: object | undefined;
        network: number;
        results: string[];
        errors: string[];
      };
      reply: (
        index: number,
        failure?: 'permanent' | 'retryable',
        data?: Record<string, unknown>
      ) => void;
      repaint: () => Promise<void>;
    };
  }
}
window.optimisticInterface = {
  snapshot: () => ({
    counts: { ...counts },
    first: { ...fieldCounts.get(rows[0].id) },
    last: fieldCounts.get(rows.at(-1)!.id),
    network: pending.length,
    results: [...results],
    errors: [...errors],
  }),
  reply(index, failure, data) {
    const operation = pending[index];
    if (!operation) throw new Error(`Missing network request ${index}`);
    replies.next({
      operation,
      stale: false,
      hasNext: false,
      ...(failure
        ? {
            error: new CombinedError(
              failure === 'retryable'
                ? { networkError: new Error('offline') }
                : { graphQLErrors: ['denied'] }
            ),
          }
        : { data: data ?? optimisticContextOf(operation)?.optimisticResponse }),
    });
  },
  async repaint() {
    await host.writeQuery({
      query: stringifyDocument(document),
      data: { user: { id: 'test-viewer', soup: { items: rows } } },
    });
  },
};

async function start() {
  if (host.disabled) throw new Error('Real worker cache is required');
  await window.optimisticInterface.repaint();
  const target = window.document.getElementById('app');
  if (!target) throw new Error('Missing mount point');
  createRoot(() => {
    const query = createQuerySignal({
      client: () => client,
      document,
      variables: () => ({}),
      requestPolicy: 'cache-only',
    });
    const stable = createSoupRowStore(
      () => query.data()?.user.soup.items ?? []
    );
    render(
      () => (
        <>
          <button id="seen" onClick={() => void submit('seen')}>
            Mark read
          </button>
          <button id="unread" onClick={() => void submit('unread')}>
            Mark unread
          </button>
          <button id="archive" onClick={() => void submit('archive')}>
            Mark done
          </button>
          <button id="undo" onClick={() => void submit('undo')}>
            Undo done
          </button>
          <For each={stable()}>{(row) => <Row row={row} />}</For>
        </>
      ),
      target
    );
  });
}
async function boot() {
  try {
    await start();
  } catch (error) {
    errors.push(String(error));
    window.document.body.dataset.error = String(error);
  }
}
void boot();
