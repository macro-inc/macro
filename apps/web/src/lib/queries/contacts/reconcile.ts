import type { CacheHost } from '@graphql-cache/host/types';
import { CONTACT_SYNC_UNSUPPORTED } from '@graphql-cache/people/sync-protocol';
import type { HydrationScope } from '@graphql-cache/protocol';
import { Telemetry } from '@macro-inc/observability';
import { fetchContactDirectoryByIds } from '@service-storage/graphql-contacts';
import { ContactDirectoryScopeError } from './cache-scope';
import { contactRecordKey } from './contact-key';

/** Verify one local keyset window using the existing exact membership lookup.
 * Only a successful, fully validated response permits deletion. Never compare a
 * paginated hydration scan with a retained all-directory seen set. */
export async function reconcileContactPage(
  host: Pick<CacheHost, 'people'>,
  scope: HydrationScope,
  after: string | null,
  signal: AbortSignal,
  fetchIds = fetchContactDirectoryByIds
) {
  return Telemetry.span('contacts.reconcile_page', async (span) => {
    try {
      signal.throwIfAborted();
      if (!host.people) throw new Error(CONTACT_SYNC_UNSUPPORTED);
      const snapshot = await host.people.snapshot({
        scope,
        scan: { after, limit: 500 },
      });
      signal.throwIfAborted();
      if ('kind' in snapshot) throw new Error(CONTACT_SYNC_UNSUPPORTED);
      span.setAttr('contacts.requested_count', snapshot.ids.length);
      if (snapshot.ids.length) {
        const response = await fetchIds(snapshot.ids, signal);
        signal.throwIfAborted();
        if (response.user.id !== scope.identity)
          throw new ContactDirectoryScopeError();
        if (response.user.contactsByUserIds.length > snapshot.ids.length)
          throw new Error('Invalid membership verification');
        const requested = new Set(snapshot.ids);
        const present = response.user.contactsByUserIds.map((contact) => {
          if (
            !requested.has(contact.userId) ||
            contactRecordKey(scope.identity, contact.userId) !==
              `GraphqlContact:${contact.id}`
          )
            throw new ContactDirectoryScopeError();
          return contact.userId;
        });
        if (
          new Set(present).size !== present.length ||
          (requested.has(scope.identity) && !present.includes(scope.identity))
        )
          throw new Error('Invalid membership verification');
        await host.people.reconcile({
          scope,
          fence: snapshot.fence,
          viewer: response.user.id,
          requested: snapshot.ids,
          present,
        });
        signal.throwIfAborted();
        span.setAttr(
          'contacts.removed_count',
          snapshot.ids.length - present.length
        );
      }
      return {
        nextCursor: snapshot.nextCursor ?? null,
        incomplete: snapshot.incomplete,
      };
    } catch (error) {
      if (!signal.aborted) span.error('Contact membership verification failed');
      throw error;
    }
  });
}
