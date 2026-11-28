import {
  type ChannelListRow,
  channelListRow,
  isChannelListRow,
} from './channel-list-row';
import { isStoreProxy, plainSoupRecord } from './plain-record';

/**
 * Shapes server (urql) records of a channel-list view as the engine shapes its
 * rows, so a row keeps one path whichever source holds it. Server records are
 * immutable and keep their object while unchanged, so a record is shaped once.
 * Rows and records that are not channels pass through.
 */
export function createServerRowShaper() {
  const rows = new WeakMap<object, ChannelListRow>();
  return <T extends object>(record: T): T | ChannelListRow => {
    if (isChannelListRow(record)) return record;
    const cached = rows.get(plainSoupRecord(record));
    if (cached) return cached;
    const row = channelListRow(record as T & { __typename: string });
    if (!isChannelListRow(row)) return record;
    // A store proxy changes in place, so its object is no key for its content.
    if (!isStoreProxy(record)) rows.set(record, row);
    return row;
  };
}
