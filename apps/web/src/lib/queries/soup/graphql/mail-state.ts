import {
  readRecordsByKeys,
  selectRecords,
} from '../../../graphql-cache/exchange/record-selection';
import type { CacheHost } from '../../../graphql-cache/host/types';
import type { CacheRevision } from '../../../graphql-cache/protocol';
import {
  MailInboxStateFieldsFragmentDoc,
  MailReadStateFieldsFragmentDoc,
  MailSignalStateFieldsFragmentDoc,
} from '../../../service-clients/service-storage/graphql/generated/graphql';

const selections = [
  selectRecords(MailInboxStateFieldsFragmentDoc),
  selectRecords(MailReadStateFieldsFragmentDoc),
  selectRecords(MailSignalStateFieldsFragmentDoc),
];

/** Select flags independently: a missing preview or another flag cannot hide a
 * known optimistic/committed update. Callers validate every returned revision. */
export async function readMailState(
  host: Pick<CacheHost, 'readRecordsByKeys'>,
  keys: string[]
) {
  const revisions: CacheRevision[] = [];
  const records = new Map<
    string,
    { inboxVisible?: boolean; isRead?: boolean; isSignal?: boolean }
  >();
  for (const selection of selections) {
    for (let offset = 0; offset < keys.length; offset += 500) {
      const result = await readRecordsByKeys<{
        inboxVisible?: boolean;
        isRead?: boolean;
        isSignal?: boolean;
      }>(host, selection, keys.slice(offset, offset + 500));
      revisions.push(result.revision);
      for (const { recordKey, record } of result.records) {
        const flags = records.get(recordKey) ?? {};
        if (typeof record.inboxVisible === 'boolean')
          flags.inboxVisible = record.inboxVisible;
        if (typeof record.isRead === 'boolean') flags.isRead = record.isRead;
        if (typeof record.isSignal === 'boolean')
          flags.isSignal = record.isSignal;
        records.set(recordKey, flags);
      }
    }
  }
  return { revisions, records };
}
