import type { IUser } from '@core/user/types';
import { MAX_PEOPLE_BATCH } from '@graphql-cache/people/generated';
import { Telemetry } from '@macro-inc/observability';
import {
  assertQueryAccount,
  type QueryAccount,
} from '@queries/auth/account-scope';
import {
  assertContactCacheScope,
  readContactCacheScope,
} from '@queries/contacts/cache-scope';
import { createContactQueryEpoch } from '@queries/contacts/query-epoch';
import {
  type ContactReferenceReader,
  createContactReferenceReader,
} from '@queries/contacts/reference-reader';
import {
  assertContactReferenceInput,
  type ContactReferenceHost,
  resolveContactReferences,
} from '@queries/contacts/references';
import { useContactDirectoryScope } from '@queries/contacts/use-directory';
import { queryReadyGate } from '@queries/gate';
import { hashKey, queryOptions, useQuery } from '@tanstack/solid-query';
import { type Accessor, createMemo, createUniqueId, onCleanup } from 'solid-js';
import { importContactKeys } from './keys';

export type AssigneeMatch =
  | { kind: 'matched'; person: IUser }
  | { kind: 'unmatched' | 'ambiguous' | 'unavailable' | 'pending' };
type Entry = { label: string; match: AssigneeMatch };

/** Invalid labels are local unmatched values, not a failure of their batch. */
function validLabel(label: string) {
  try {
    assertContactReferenceInput({
      labels: [label],
      matching: 'exact',
      excludeSecondaryInboxes: false,
    });
    return true;
  } catch {
    return false;
  }
}

/** Retain only the import's requested identities, not a directory. Reads are
 * serialized in wire-sized batches; two witnesses never become a chosen user. */
export async function readImportAssignees(
  viewer: string,
  host: ContactReferenceHost | undefined,
  labels: readonly string[],
  signal: AbortSignal,
  read: ContactReferenceReader = resolveContactReferences
): Promise<Entry[]> {
  return Telemetry.span('contacts.import_assignees', async (span) => {
    const entries: Entry[] = [];
    const generation =
      host && !host.disabled
        ? await readContactCacheScope(host, viewer, signal)
        : undefined;
    span.setAttr('contacts.reference_count', labels.length);
    for (let offset = 0; offset < labels.length; offset += MAX_PEOPLE_BATCH) {
      signal.throwIfAborted();
      const batch = labels
        .slice(offset, offset + MAX_PEOPLE_BATCH)
        .filter((label) => {
          if (validLabel(label)) return true;
          entries.push({ label, match: { kind: 'unmatched' } });
          return false;
        });
      if (!batch.length) continue;
      const result = await read(
        viewer,
        host,
        { labels: batch, matching: 'exact', excludeSecondaryInboxes: false },
        signal
      );
      signal.throwIfAborted();
      if (host && generation)
        await assertContactCacheScope(host, viewer, generation, signal);
      if (result.matches.length !== batch.length)
        throw new Error('Invalid import reference response');
      result.matches.forEach((match, index) => {
        const label = batch[index];
        if (!match.complete)
          entries.push({ label, match: { kind: 'unavailable' } });
        else if (match.people.length === 0)
          entries.push({ label, match: { kind: 'unmatched' } });
        else if (match.people.length !== 1)
          entries.push({ label, match: { kind: 'ambiguous' } });
        else {
          const person = match.people[0];
          entries.push({
            label,
            match: {
              kind: 'matched',
              person: {
                id: person.userId,
                email: person.email,
                name: person.name ?? person.email,
              },
            },
          });
        }
      });
    }
    return entries;
  });
}

function assigneeOptions(
  owner: string,
  account: QueryAccount,
  host: ContactReferenceHost | undefined,
  epoch: number,
  revision: number,
  labels: readonly string[],
  read: ContactReferenceReader
) {
  return queryOptions({
    queryKey: importContactKeys.assignees(
      owner,
      account,
      host?.clientId ?? 'network',
      epoch,
      revision,
      labels
    ).queryKey,
    enabled: labels.length > 0,
    queryFn: async ({ signal }) => {
      assertQueryAccount(account);
      const entries = await readImportAssignees(
        account.userId,
        host,
        labels,
        signal,
        read
      );
      assertQueryAccount(account);
      return {
        epoch,
        revision,
        hostId: host?.clientId,
        input: hashKey([labels]),
        entries,
      };
    },
    gcTime: 0,
    staleTime: 0,
    retry: false,
    networkMode: 'always',
    refetchOnReconnect: true,
    refetchOnWindowFocus: false,
  });
}

/** One observer/reader for the current upload. Manual choices live outside it. */
export function useImportAssignees(
  account: QueryAccount,
  labels: Accessor<readonly string[]>,
  revision: Accessor<number>
) {
  const directory = useContactDirectoryScope();
  const { epoch } = createContactQueryEpoch(directory);
  const owner = createUniqueId();
  const reader = createContactReferenceReader();
  onCleanup(reader.dispose);
  const input = createMemo(() => [...labels()]);
  const query = useQuery(() =>
    assigneeOptions(
      owner,
      account,
      directory().host,
      epoch(),
      revision(),
      input(),
      reader.read
    )
  );
  const matches = createMemo(() => {
    if (!queryReadyGate(query) || query.error)
      return new Map<string, AssigneeMatch>();
    const result = query.data;
    if (
      result.epoch !== epoch() ||
      result.revision !== revision() ||
      result.hostId !== directory().host?.clientId ||
      result.input !== hashKey([input()])
    )
      return new Map<string, AssigneeMatch>();
    return new Map(result.entries.map((entry) => [entry.label, entry.match]));
  });
  return {
    match: (label: string): AssigneeMatch =>
      matches().get(label) ?? {
        kind: query.isError ? 'unavailable' : 'pending',
      },
    retry: () => query.refetch({ cancelRefetch: false }),
  };
}
