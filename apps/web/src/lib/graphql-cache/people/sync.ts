import type { CacheHost } from '../host/types';
import type { HydrationScope } from '../protocol';

/** Capture before the network request, never after receiving data or retrying
 * admission. Older hosts cannot silently downgrade this contact-write guard. */
export async function captureContactWriteScope(
  host: Pick<CacheHost, 'people'>,
  scope: HydrationScope,
  signal: AbortSignal
): Promise<HydrationScope | undefined> {
  signal.throwIfAborted();
  if (!host.people) return;
  const snapshot = await host.people.snapshot({ scope });
  signal.throwIfAborted();
  if ('kind' in snapshot) return;
  if (
    snapshot.ids.length ||
    snapshot.nextCursor !== null ||
    snapshot.incomplete
  )
    throw new Error('Invalid contact capture');
  return { ...scope, contactFence: snapshot.fence };
}
