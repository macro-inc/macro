import { fireAndForget } from '@core/util/fireAndForget';
import { createRetirableCacheHost } from '@graphql-cache/host/retirable-host';
import { createWorkerCacheHost } from '@graphql-cache/host/worker-host';
import { captureContactWriteScope } from '@graphql-cache/people/sync';
import type { HydrationScope } from '@graphql-cache/protocol';
import {
  loadContactCheckpoint,
  runContactBackfill,
} from '@queries/contacts/backfill';
import { contactRecordKey } from '@queries/contacts/contact-key';
import { reconcileContactPage } from '@queries/contacts/reconcile';
import type { ContactDirectoryByUserIdsQuery } from '@service-storage/graphql/generated/graphql';
import * as Effect from 'effect/Effect';
import { createSignal, onCleanup, onMount } from 'solid-js';

const viewer = 'macro|viewer@example.com';
const removedId = 'macro|late@example.com';
const document =
  '{ user { id contacts(limit: 500) { nodes { id userId name email } nextCursor } } }';
function person(
  userId: string
): ContactDirectoryByUserIdsQuery['user']['contactsByUserIds'][number] {
  return {
    id: contactRecordKey(viewer, userId).slice('GraphqlContact:'.length),
    userId,
    email: userId.slice(6),
    name: userId === removedId ? 'Late person' : 'Member',
  };
}

/** Real backfill, exact-verification adapter, worker and OPFS; only authority data is synthetic. */
export function ContactRemovalFixture() {
  const host = createRetirableCacheHost(
    createWorkerCacheHost({ scope: `removal-${crypto.randomUUID()}` })
  );
  const [status, setStatus] = createSignal('starting');
  const [count, setCount] = createSignal('');
  const [lateResult, setLateResult] = createSignal('');
  let removed = false;
  let hold: ReturnType<typeof Promise.withResolvers<void>> | undefined;
  let stale: HydrationScope | undefined;
  let controller: AbortController | undefined;
  onCleanup(() => {
    controller?.abort();
    hold?.resolve();
    host.dispose();
  });
  async function inspect() {
    if (!host.people) throw new Error('Missing people cache');
    const result = await host.people.readSql({
      scope: {
        identity: viewer,
        storageGeneration: await host.currentStorageGeneration(),
      },
      input: { kind: 'statement', sql: 'SELECT COUNT(*) FROM macro.people' },
    });
    if (result.kind !== 'result') throw new Error('SQL unavailable');
    const cell = result.outcome.rows[0]?.[0];
    setCount(cell?.type === 'number' ? String(cell.value) : 'invalid');
  }
  async function pass(force = false) {
    controller = new AbortController();
    const signal = controller.signal;
    try {
      if (force) {
        const generation = await host.currentStorageGeneration();
        const checkpoint = loadContactCheckpoint(viewer, generation);
        if (checkpoint.completedAt !== null)
          localStorage.setItem(
            `graphql-contacts-backfill:v2:${viewer}`,
            JSON.stringify({ ...checkpoint, completedAt: 1 })
          );
      }
      await Effect.runPromise(
        runContactBackfill(viewer, host, {
          pageDelayMs: 0,
          fetchPage: async (cache, scope, after, signal) => {
            const guarded = await captureContactWriteScope(
              cache,
              scope,
              signal
            );
            if (!guarded) throw new Error('Missing fence');
            const start = after === null ? 0 : Number(after);
            const end = Math.min(start + 500, 601);
            const nodes = Array.from({ length: end - start }, (_, offset) =>
              person(
                start + offset === 0
                  ? viewer
                  : start + offset === 600
                    ? removedId
                    : `macro|p${start + offset}@example.com`
              )
            ).filter((node) => !removed || node.userId !== removedId);
            const nextCursor = end === 601 ? null : String(end);
            await cache.hydrateQuery({
              query: document,
              data: { user: { id: viewer, contacts: { nodes, nextCursor } } },
              identity: viewer,
              hydrationScope: guarded,
            });
            return { user: { id: viewer, contacts: { nextCursor } } };
          },
          reconcilePage: async (cache, scope, after, signal) => {
            if (hold) {
              stale = await captureContactWriteScope(host, scope, signal);
              await inspect();
              setStatus('verification held');
              const held = hold;
              await held.promise;
              hold = undefined;
            }
            return reconcileContactPage(
              cache,
              scope,
              after,
              signal,
              async (ids, requestSignal) => {
                requestSignal.throwIfAborted();
                return {
                  user: {
                    id: viewer,
                    contactsByUserIds: ids
                      .filter((id) => !removed || id !== removedId)
                      .map(person),
                  },
                };
              }
            );
          },
        }),
        { signal }
      );
      await inspect();
      setStatus('complete');
    } catch (error) {
      setStatus(signal.aborted ? 'canceled' : String(error));
    }
  }
  async function late() {
    if (!stale) throw new Error('Missing held hydration');
    try {
      await host.hydrateQuery({
        query: document,
        data: {
          user: {
            id: viewer,
            contacts: { nodes: [person(removedId)], nextCursor: null },
          },
        },
        identity: viewer,
        hydrationScope: stale,
      });
      setLateResult('incorrectly admitted');
    } catch (error) {
      setLateResult(String(error));
    }
    await inspect();
  }
  onMount(() => fireAndForget(pass(), 'contact-removal-fixture'));
  return (
    <main class="p-4 flex flex-col gap-2">
      <output data-testid="removal-status">{status()}</output>
      <output data-testid="stored-contacts">{count()}</output>
      <output data-testid="late-hydration">{lateResult()}</output>
      <button
        onClick={() => {
          removed = true;
          hold = Promise.withResolvers<void>();
          fireAndForget(pass(true), 'contact-removal-fixture');
        }}
      >
        Remove membership
      </button>
      <button onClick={() => hold?.resolve()}>Verify membership</button>
      <button
        onClick={() => {
          controller?.abort();
          hold?.resolve();
        }}
      >
        Cancel verification
      </button>
      <button
        onClick={() => fireAndForget(pass(true), 'contact-removal-fixture')}
      >
        Resume
      </button>
      <button onClick={() => fireAndForget(late(), 'contact-removal-fixture')}>
        Apply old hydration
      </button>
      <button
        onClick={() => {
          removed = false;
          fireAndForget(pass(true), 'contact-removal-fixture');
        }}
      >
        Restore membership
      </button>
    </main>
  );
}
