import { EmailThreadOwnerFieldsFragmentDoc } from '@service-storage/graphql/generated/graphql';
import { hasOwnedEmailWitness, rememberOwnedEmail } from './authority-scope';
import { readRecordsByKeys, selectRecords } from './exchange/record-selection';
import type { CacheHost } from './host/types';
import { sourceAuthorityGeneration } from './source-authority';

type OwnershipHost = Pick<CacheHost, 'authority' | 'readRecordsByKeys'>;
const pending = new WeakMap<OwnershipHost, Map<string, Promise<void>>>();

/** Read only ownership metadata before exposing a cached thread without CRM proof. */
export async function witnessOwnedEmail(
  host: OwnershipHost,
  threadId: string,
  account: () => string | undefined,
  assertSession: () => void,
  isCurrentHost: () => boolean
): Promise<boolean> {
  await witnessOwnedEmails(
    host,
    [threadId],
    account,
    assertSession,
    isCurrentHost
  );
  return hasOwnedEmailWitness(threadId);
}

/** A Mail page proves ownership in bounded batches, without one IPC per row. */
export async function witnessOwnedEmails(
  host: OwnershipHost,
  threadIds: readonly string[],
  account: () => string | undefined,
  assertSession: () => void,
  isCurrentHost: () => boolean
): Promise<void> {
  assertSession();
  if (!isCurrentHost() || !account()) return;
  const missing = [...new Set(threadIds)].filter(
    (id) => !hasOwnedEmailWitness(id)
  );
  if (!missing.length) return;
  let reads = pending.get(host);
  if (!reads) {
    reads = new Map();
    pending.set(host, reads);
  }
  const waiting = new Set<Promise<void>>();
  const unclaimed = missing.filter((id) => {
    const existing = reads.get(id);
    if (!existing) return true;
    waiting.add(existing);
    return false;
  });
  for (let offset = 0; offset < unclaimed.length; offset += 500) {
    const ids = unclaimed.slice(offset, offset + 500);
    const read = readWitnesses(
      host,
      ids,
      account,
      assertSession,
      isCurrentHost
    ).finally(() => {
      for (const id of ids) if (reads.get(id) === read) reads.delete(id);
    });
    for (const id of ids) reads.set(id, read);
    waiting.add(read);
  }
  await Promise.all(waiting);
  assertSession();
}

async function readWitnesses(
  host: OwnershipHost,
  threadIds: readonly string[],
  account: () => string | undefined,
  assertSession: () => void,
  isCurrentHost: () => boolean
): Promise<void> {
  const owner = host.authority;
  const viewer = account();
  if (!owner || !viewer) return;
  const before = owner.snapshot() ?? (await owner.current());
  assertSession();
  if (before.account !== viewer || !isCurrentHost()) return;
  const result = await readRecordsByKeys(
    host,
    selectRecords(EmailThreadOwnerFieldsFragmentDoc),
    threadIds.map((id) => `GraphqlSoupEmailThread:${id}`)
  );
  assertSession();
  if (sourceAuthorityGeneration(result) !== before.generation) return;
  const isCurrent = () => {
    try {
      assertSession();
    } catch {
      return false;
    }
    const current = owner.snapshot();
    return (
      isCurrentHost() &&
      host.authority === owner &&
      account() === viewer &&
      current?.account === viewer &&
      current.generation === before.generation
    );
  };
  if (!isCurrent()) return;
  const requestedIds = new Set(threadIds);
  for (const { recordKey, record } of result.records) {
    if (record.ownerId !== viewer) continue;
    const requested = recordKey.slice('GraphqlSoupEmailThread:'.length);
    if (!requestedIds.has(requested)) continue;
    rememberOwnedEmail(requested, isCurrent);
    rememberOwnedEmail(record.id, isCurrent);
  }
}
