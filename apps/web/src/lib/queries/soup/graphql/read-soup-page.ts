import { retainOwnedEmailWitnesses } from '@graphql-cache/authority-scope';
import { witnessOwnedEmails } from '@graphql-cache/owned-email-authority';
import { crmAccessAuthority } from '@service-storage/crm-access-authority';
import type { RecordSelection } from '../../../graphql-cache/exchange/record-selection';
import { readRecordsByKeys } from '../../../graphql-cache/exchange/record-selection';
import type { CacheHost } from '../../../graphql-cache/host/types';
import type { EntityFilterCacheResult } from '../../../graphql-cache/protocol';
import type { MailItemFieldsFragment } from '../../../service-clients/service-storage/graphql/generated/graphql';
import {
  type GraphqlSoupItem,
  getGraphqlSoupCacheHost,
} from '../../../service-clients/service-storage/graphql-soup';
import { readMailState } from './mail-state';
import { type CachedMailView, materializeMailView } from './mail-view';
import { materializeReconciledSoup, soupItemKey } from './reconciliation';

/** Compatibility materialization for Mail pages and hosts without live views.
 * Both initial reads and pagination publish only a single coherent revision.
 */
export async function readSoupPage(
  host: Pick<CacheHost, 'readRecordsByKeys' | 'currentRevision' | 'authority'>,
  options: {
    page: Extract<
      EntityFilterCacheResult,
      { kind: 'reconciled' | 'mail-page' }
    >;
    select: RecordSelection<GraphqlSoupItem>;
    baseline: readonly GraphqlSoupItem[];
    mailView?: CachedMailView;
    keys?: readonly string[];
  }
) {
  const { page, select, baseline, mailView, keys = page.keys } = options;
  const chunks = [];
  const states: Awaited<ReturnType<typeof readMailState>>[] = [];
  const snapshots = new Map(
    baseline.map((record) => [soupItemKey(record), record])
  );
  for (let offset = 0; offset < Math.max(1, page.keys.length); offset += 500) {
    const pageKeys = page.keys.slice(offset, offset + 500);
    const mailIds = pageKeys
      .filter((key) => key.startsWith('GraphqlSoupEmailThread:'))
      .map((key) => key.slice('GraphqlSoupEmailThread:'.length));
    // Acquire before metadata resolves: another pane can fill the idle cache
    // before this read resumes, or between its independent fallback flag reads.
    const releaseWitnesses = retainOwnedEmailWitnesses(mailIds);
    try {
      if (host.authority && mailIds.length) {
        await witnessOwnedEmails(
          host,
          mailIds,
          crmAccessAuthority.account,
          crmAccessAuthority.captureSession(),
          () => getGraphqlSoupCacheHost() === host
        );
      }
      const chunk = await readRecordsByKeys(host, select, pageKeys);
      chunks.push(chunk);
      const selected = new Map(
        chunk.records.map((row) => [row.recordKey, row.record])
      );
      const fallbackKeys =
        page.kind === 'mail-page'
          ? pageKeys.filter((key) => {
              if (!snapshots.has(key)) return false;
              const record = selected.get(key);
              return (
                !record ||
                !mailView ||
                !materializeMailView(
                  record as MailItemFieldsFragment,
                  mailView,
                  ''
                )
              );
            })
          : [];
      states.push(await readMailState(host, fallbackKeys));
    } finally {
      releaseWitnesses();
    }
  }
  const selected = chunks.flatMap((chunk) => chunk.records);
  const selectedByKey = new Map(
    selected.map((row) => [row.recordKey, row.record])
  );
  const state = {
    revisions: states.flatMap((state) => state.revisions),
    records: new Map(states.flatMap((state) => [...state.records])),
  };
  const revision = await host.currentRevision();
  if (
    page.revision !== revision ||
    chunks.some((chunk) => chunk.revision !== revision) ||
    state.revisions.some((value) => value !== revision)
  )
    return { kind: 'stale' as const, revision };

  const timestamps =
    page.kind === 'mail-page'
      ? new Map(page.keys.map((key, i) => [key, page.sortTimestamps[i]]))
      : undefined;
  const records = materializeReconciledSoup(keys, selected, baseline).flatMap(
    (record) => {
      const key = soupItemKey(record);
      const timestamp = timestamps?.get(key);
      if (!timestamp || !mailView) return [record];
      // Older hosts can confirm membership before the canonical preview is
      // readable. Prefer canonical fields as soon as they become available.
      const current = selectedByKey.get(key);
      const canonical =
        current &&
        materializeMailView(
          current as MailItemFieldsFragment,
          mailView,
          timestamp
        );
      if (canonical) return [canonical];
      const snapshot = snapshots.get(key);
      if (snapshot?.__typename !== 'GraphqlSoupEmailThread') return [];
      // Only preview fields are query-dependent. Shared fields remain live,
      // including flags readable without the canonical-preview fragment.
      return [
        {
          ...snapshot,
          ...(current?.__typename === 'GraphqlSoupEmailThread' ? current : {}),
          ...state.records.get(key),
          createdAt: timestamp,
          emailName: snapshot.emailName,
          snippet: snapshot.snippet,
          isDraft: snapshot.isDraft,
          senderEmail: snapshot.senderEmail,
          senderName: snapshot.senderName,
          senderPhotoUrl: snapshot.senderPhotoUrl,
        },
      ];
    }
  );
  return { kind: 'ready' as const, revision, records };
}
