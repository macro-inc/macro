import { fireAndForget } from '@core/util/fireAndForget';
import { captureContactWriteScope } from '@graphql-cache/people/sync';
import { Telemetry } from '@macro-inc/observability';
import { fetchContactDirectoryByIds } from '@service-storage/graphql-contacts';
import { type Accessor, createEffect, onCleanup } from 'solid-js';
import { useQueryAccount } from '../auth/use-query-account';
import { type ContactLookupHost, resolveContactDirectory } from './lookup';
import { subscribeContactTopUp } from './refresh';
import { acquireContactWriteTurn } from './write-turn';

/** Re-read the contacts an invalidation named and store them in the local
 * cache, so pickers show a new contact without waiting for the next scan. The
 * exact lookup writes under the contact write scope; ids it omits are left for
 * the scan's verification pass to remove. */
export async function topUpContacts(
  viewer: string,
  host: ContactLookupHost,
  ids: readonly string[],
  signal: AbortSignal,
  fetchIds = fetchContactDirectoryByIds
): Promise<void> {
  await Telemetry.span('contacts.top_up', async (span) => {
    span.setAttr('contacts.requested_count', ids.length);
    const release = await span.span('contacts.top_up.wait', () =>
      acquireContactWriteTurn(host)
    );
    try {
      // A host that cannot take a fenced contact write would discard the
      // lookup, so it does not make one.
      const scope = {
        identity: viewer,
        storageGeneration: await host.currentStorageGeneration(),
      };
      if (!(await captureContactWriteScope(host, scope, signal))) {
        span.setAttr('contacts.source', 'unsupported');
        return;
      }

      // Browser context does not survive the waits above; keep the lookup's
      // spans and request under this one.
      const resolution = await span.run(() =>
        resolveContactDirectory(
          viewer,
          host,
          { kind: 'ids', values: ids },
          signal,
          fetchIds
        )
      );
      span.setAttr('contacts.resolved_count', resolution.users.length);
      span.setAttr('contacts.source', resolution.source);
    } catch {
      // The periodic scan the same invalidation scheduled covers a failure.
      if (!signal.aborted) span.error('Contact top-up failed');
    } finally {
      release();
    }
  });
}

/** Runs top-ups in the tab that runs the contact backfill, for as long as it
 * owns the account's cache. */
export function useContactTopUp(
  userId: Accessor<string | undefined>,
  host: Accessor<ContactLookupHost | undefined>,
  generation: Accessor<number>
): void {
  const account = useQueryAccount();
  createEffect(() => {
    const owner = account();
    const id = userId();
    const cache = host();
    generation();
    if (!owner || owner.userId !== id || !id || !cache || cache.disabled)
      return;

    const controller = new AbortController();
    const unsubscribe = subscribeContactTopUp((ids, context) => {
      fireAndForget(
        context.run(() => topUpContacts(id, cache, ids, controller.signal)),
        'contacts-top-up'
      );
    });
    onCleanup(() => {
      unsubscribe();
      controller.abort();
    });
  });
}
