import { fireAndForget } from '@core/util/fireAndForget';
import { createRetirableCacheHost } from '@graphql-cache/host/retirable-host';
import type { CacheHost } from '@graphql-cache/host/types';
import { createWorkerCacheHost } from '@graphql-cache/host/worker-host';
import { runContactBackfill } from '@queries/contacts/backfill';
import { contactRecordKey } from '@queries/contacts/contact-key';
import { createDatabaseSqlQuery } from '@queries/database-sql/create-database-sql-query';
import { readLocalSql } from '@queries/database-sql/local-read';
import * as Effect from 'effect/Effect';
import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { account, setAccount } from './test-account';

/** Real compiler, controller, worker host, WASM and OPFS. Only hydration data is synthetic. */
export function SqlPeopleFixture() {
  const host = createRetirableCacheHost(
    createWorkerCacheHost({ scope: `sql-people-${crypto.randomUUID()}` })
  );
  const [ready, setReady] = createSignal(false);
  const [failure, setFailure] = createSignal('');
  onCleanup(() => host.dispose());
  onMount(() => {
    const seed = async () => {
      try {
        const viewer = account().userId;
        await Effect.runPromise(
          runContactBackfill(viewer, host, {
            pageDelayMs: 0,
            fetchPage: async (cache, scope, after, signal) => {
              signal.throwIfAborted();
              const start = after === null ? 0 : Number(after);
              const end = Math.min(start + 500, 1001);
              const nodes = Array.from({ length: end - start }, (_, offset) => {
                const index = start + offset;
                const email =
                  index === 0
                    ? 'viewer@example.com'
                    : index === 1000
                      ? 'late@example.com'
                      : `person${index}@example.com`;
                const userId = `macro|${email}`;
                return {
                  __typename: 'GraphqlContact',
                  id: contactRecordKey(viewer, userId).slice(
                    'GraphqlContact:'.length
                  ),
                  userId,
                  email,
                  name:
                    index === 1000 ? 'Late private name' : `Person ${index}`,
                };
              });
              const nextCursor = end === 1001 ? null : String(end);
              await cache.hydrateQuery({
                query:
                  '{ user { id contacts(limit: 500) { nodes { __typename id userId name email } nextCursor } } }',
                data: { user: { id: viewer, contacts: { nodes, nextCursor } } },
                identity: viewer,
                hydrationScope: scope,
              });
              return { user: { id: viewer, contacts: { nextCursor } } };
            },
          })
        );
        setReady(true);
      } catch (error) {
        setFailure(String(error));
      }
    };
    fireAndForget(seed(), 'local-sql-fixture');
  });
  return (
    <Show
      when={ready()}
      fallback={
        <output data-testid="sql-setup">
          {failure() || 'Preparing local records'}
        </output>
      }
    >
      <SqlQuery host={host} />
    </Show>
  );
}

function SqlQuery(props: { host: CacheHost }) {
  const [sql, setSql] = createSignal(
    'SELECT COUNT(*) AS total FROM macro.people'
  );
  const [enabled, setEnabled] = createSignal(true);
  const [reads, setReads] = createSignal(0);
  const [held, setHeld] = createSignal(false);
  let holdNext = false;
  let release: (() => void) | undefined;
  onCleanup(() => release?.());
  const query = createDatabaseSqlQuery(
    () => ({ schema: { databases: [], platform: ['people'] }, sql: sql() }),
    {
      account,
      client: () => {
        throw new Error(
          'A direct people statement must not construct GraphQL row sources'
        );
      },
      cacheHost: () => props.host,
      localPeople: () => (enabled() ? props.host : undefined),
      localRead: async (input, signal) => {
        setReads((count) => count + 1);
        const result = await readLocalSql(input, signal);
        if (holdNext) {
          holdNext = false;
          const pending = Promise.withResolvers<void>();
          release = pending.resolve;
          setHeld(true);
          await pending.promise;
          setHeld(false);
          release = undefined;
        }
        return result;
      },
    }
  );
  return (
    <main class="h-dvh overflow-auto p-4 bg-page text-ink flex flex-col gap-3">
      <label>
        SQL
        <textarea
          aria-label="SQL"
          class="border border-edge bg-input p-2 block w-full"
          value={sql()}
          onInput={(event) => setSql(event.currentTarget.value)}
        />
      </label>
      <button onClick={() => fireAndForget(query.refresh(), 'sql-fixture')}>
        Refresh read
      </button>
      <button
        onClick={() =>
          setAccount({ ...account(), session: account().session + 1 })
        }
      >
        Replace login
      </button>
      <button onClick={() => setEnabled(false)}>Disable local SQL</button>
      <button
        onClick={() => {
          holdNext = true;
        }}
      >
        Hold next read
      </button>
      <button onClick={() => release?.()}>Release read</button>
      <output data-testid="sql-native-reads">{reads()}</output>
      <output data-testid="sql-held">{String(held())}</output>
      <output data-testid="sql-loading">{String(query.loading())}</output>
      <output data-testid="sql-cached">{String(query.cached())}</output>
      <p role="alert">
        {query.error()?.kind === 'read-only'
          ? 'Read only'
          : query.error()?.kind}
      </p>
      <pre data-testid="sql-result">
        {JSON.stringify(query.outcome()?.rows)}
      </pre>
    </main>
  );
}
