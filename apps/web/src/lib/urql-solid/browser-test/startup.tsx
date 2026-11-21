import { fireAndForget } from '@core/util/fireAndForget';
import type {
  CacheAuthority,
  CacheAuthorityHost,
} from '@graphql-cache/authority';
import { cacheSessionExchange } from '@graphql-cache/exchange/session-exchange';
import { initialCacheRetirement } from '@graphql-cache/generation-mirror';
import { cacheSessionGeneration } from '@graphql-cache/session-generation';
import { ContextMenu } from '@kobalte/core/context-menu';
import { createCrmAccessAuthority } from '@service-storage/crm-access-authority';
import {
  createClient,
  type Exchange,
  gql,
  type OperationResult,
} from '@urql/core';
import { createSignal, For } from 'solid-js';
import { render } from 'solid-js/web';
import { filter, make, mergeMap, pipe } from 'wonka';
import { createUrqlQuery } from '../create-urql-query';

const mode = new URLSearchParams(location.search).get('owner');
const TEAM = '00000000-0000-4000-8000-000000000001';
const baseline = Promise.withResolvers<CacheAuthority>();
const owner: CacheAuthorityHost = {
  current: () => baseline.promise,
  snapshot: () => undefined,
  onChanged: () => () => {},
  transition: async () => {
    throw new Error('Startup observation must not request or commit a proof');
  },
};
const authority = createCrmAccessAuthority({
  initialize: cacheSessionGeneration.initialize,
  restore: (next) => initialCacheRetirement(undefined, next),
  retire: (_scope, generation) =>
    cacheSessionGeneration.transition(async () => {}, generation),
  fetchProof: async () => {
    throw new Error('Startup observation must not request a proof');
  },
});
authority.setHost(owner);
authority.setSession('viewer');
const observing = authority.initialize();
let reads = 0;
const waiting = new Set<() => void>();
const transport: Exchange = () => (operations) =>
  pipe(
    operations,
    filter((operation) => operation.kind === 'query'),
    mergeMap((operation) =>
      make<OperationResult>(({ next, complete }) => {
        const first = ++reads === 1;
        const deliver = () => {
          next({
            operation,
            data: {
              rows: [
                {
                  id: 'thread-1',
                  subject: first ? 'Agenda' : 'Updated agenda',
                },
              ],
            },
            stale: false,
            hasNext: false,
          });
          complete();
        };
        if (first) queueMicrotask(deliver);
        else waiting.add(deliver);
        return () => waiting.delete(deliver);
      })
    )
  );
const client = createClient({
  url: 'https://localhost/graphql',
  exchanges: [cacheSessionExchange, transport],
});

declare global {
  interface Window {
    startupRecovery: {
      completeOwner(): Promise<void>;
      refetch(): void;
      releaseReads(): void;
    };
  }
}

function Harness() {
  const query = createUrqlQuery<
    { rows: { id: string; subject: string }[] },
    Record<string, never>
  >(() => ({
    client,
    query: gql`query MailRows { rows { id subject } }`,
    variables: {},
  }));
  const [copied, setCopied] = createSignal('');
  window.startupRecovery = {
    async completeOwner() {
      baseline.resolve({
        identity: 'profile',
        account:
          mode === 'fresh'
            ? null
            : mode === 'other-account'
              ? 'previous-viewer'
              : 'viewer',
        generation: crypto.randomUUID(),
        policy:
          mode === 'fresh' || mode === 'upgrade'
            ? null
            : `${TEAM}:${mode === 'denied' ? 'denied' : 'allowed'}`,
        ready: mode !== 'fresh' && mode !== 'upgrade',
      });
      await observing;
    },
    refetch: () =>
      fireAndForget(
        query.refetch({ requestPolicy: 'network-only' }),
        'startup-fixture'
      ),
    releaseReads() {
      for (const deliver of waiting) deliver();
      waiting.clear();
    },
  };
  return (
    <main>
      <For each={query.data?.rows}>
        {(row) => (
          <ContextMenu>
            <ContextMenu.Trigger
              as="div"
              role="row"
              style={{ padding: '24px' }}
            >
              {row.subject}
            </ContextMenu.Trigger>
            <ContextMenu.Portal>
              <ContextMenu.Content
                style={{
                  background: 'white',
                  border: '1px solid',
                  padding: '12px',
                }}
              >
                <ContextMenu.Item onSelect={() => setCopied(row.id)}>
                  Copy Link
                </ContextMenu.Item>
              </ContextMenu.Content>
            </ContextMenu.Portal>
          </ContextMenu>
        )}
      </For>
      <output aria-label="Copied row">{copied()}</output>
    </main>
  );
}

const root = document.getElementById('app');
if (!root) throw new Error('Missing harness root');
render(() => <Harness />, root);
