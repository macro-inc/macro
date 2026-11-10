import type { CacheHost } from '@graphql-cache/host/types';
import { ContactDirectoryIdentityDocument } from '@service-storage/graphql/generated/graphql';
import { print } from 'graphql';

type ScopeHost = Pick<CacheHost, 'currentStorageGeneration' | 'readQuery'>;
const IDENTITY_DOCUMENT = print(ContactDirectoryIdentityDocument);

export class ContactDirectoryScopeError extends Error {
  constructor() {
    super('Contact directory scope changed; restart this page');
  }
}

function hasViewer(data: unknown, viewer: string): boolean {
  return (
    typeof data === 'object' &&
    data !== null &&
    'user' in data &&
    typeof data.user === 'object' &&
    data.user !== null &&
    'id' in data.user &&
    data.user.id === viewer
  );
}
async function currentViewer(
  host: ScopeHost,
  viewer: string
): Promise<boolean> {
  const result = await host.readQuery({
    query: IDENTITY_DOCUMENT,
    operationName: 'ContactDirectoryIdentity',
  });
  return result.kind === 'hit' && hasViewer(result.data, viewer);
}

/** Reads belong only to the expected viewer, never whichever account happens to
 * own a shared engine. The final generation check must follow identity reads. */
export async function readContactCacheScope(
  host: ScopeHost,
  viewer: string,
  signal: AbortSignal
): Promise<string | undefined> {
  signal.throwIfAborted();
  const generation = await host.currentStorageGeneration();
  const matches = await currentViewer(host, viewer);
  signal.throwIfAborted();
  return matches ? generation : undefined;
}

export async function assertContactCacheScope(
  host: ScopeHost,
  viewer: string,
  generation: string,
  signal: AbortSignal
): Promise<void> {
  signal.throwIfAborted();
  if (
    !(await currentViewer(host, viewer)) ||
    generation !== (await host.currentStorageGeneration())
  )
    throw new ContactDirectoryScopeError();
  signal.throwIfAborted();
}
