import { isStaleCacheDatabaseIdentity } from './coordinator-protocol';

const WAL_SUFFIX = '-wal';

/**
 * A database's WAL file is its name plus `-wal`, so the database of a scope
 * ending in `-wal` would read as another scope's WAL file and could be
 * removed with it. App scopes are UUIDs; a host refuses any other such scope.
 */
export const isUnambiguousCacheScope = (scope: string): boolean =>
  !scope.endsWith(WAL_SUFFIX);

/** This scope's databases this build does not open, from OPFS entry names. */
export function staleCacheDatabaseIdentities(
  scope: string,
  entryNames: Iterable<string>
): string[] {
  const identities = new Set<string>();
  for (const name of entryNames) {
    const identity = name.endsWith(WAL_SUFFIX)
      ? name.slice(0, -WAL_SUFFIX.length)
      : name;
    if (isStaleCacheDatabaseIdentity(scope, identity)) identities.add(identity);
  }
  return [...identities];
}

/** Lists the origin-private root without opening any file. */
export async function listOpfsRootNames(): Promise<string[]> {
  const root = await navigator.storage.getDirectory();
  const names: string[] = [];
  for await (const name of root.keys()) names.push(name);
  return names;
}

export type StaleDatabaseRemovalOutcome = {
  outcome: 'removed' | 'in-use' | 'queued-mutations';
  queuedMutations?: number;
};

export type StaleDatabaseCleanupTally = {
  removed: number;
  inUse: number;
  keptWithQueuedMutations: number;
  failed: boolean;
};

/**
 * Deletes each stale database whose owner lock is free and whose mutation
 * queue is empty. Stops at the first failure: in the disposable cleanup worker
 * it can leave the worker-local OPFS registry poisoned.
 */
export async function removeStaleCacheDatabases(
  identities: readonly string[],
  removeOne: (identity: string) => Promise<StaleDatabaseRemovalOutcome>
): Promise<StaleDatabaseCleanupTally> {
  const tally: StaleDatabaseCleanupTally = {
    removed: 0,
    inUse: 0,
    keptWithQueuedMutations: 0,
    failed: false,
  };
  for (const identity of identities) {
    let result: StaleDatabaseRemovalOutcome;
    try {
      result = await removeOne(identity);
    } catch {
      tally.failed = true;
      break;
    }
    if (result.outcome === 'removed') tally.removed += 1;
    else if (result.outcome === 'in-use') tally.inUse += 1;
    else tally.keptWithQueuedMutations += 1;
  }
  return tally;
}
