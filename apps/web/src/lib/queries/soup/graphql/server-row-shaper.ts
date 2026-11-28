import {
  readRowVersion,
  unwrapStoreProxy,
} from '../../../graphql-cache/exchange/live-query';
import {
  type ChannelListRow,
  channelListRow,
  isChannelListRow,
} from './channel-list-row';

/**
 * Shapes server (urql) records of a channel-list view as the engine shapes its
 * rows, so a row keeps one path whichever source holds it. Server records are
 * versioned in place: shaping one subscribes to its version, a record is shaped
 * again only when its version moved, and an unchanged shape keeps the row it
 * had. Rows and records that are not channels pass through.
 */
export function createServerRowShaper() {
  const rows = new WeakMap<
    object,
    { version: unknown; json: string; row: ChannelListRow }
  >();
  return <T extends object>(record: T): T | ChannelListRow => {
    if (isChannelListRow(record)) return record;
    const { raw, version } = readRowVersion(record);
    const cached = rows.get(raw);
    // An unversioned store tracks its fields one by one: shape it each time,
    // so the read subscribes to them.
    const stable = version !== undefined || unwrapStoreProxy(raw) === raw;
    if (cached && stable && cached.version === version) return cached.row;
    const row = channelListRow(raw as T & { __typename: string });
    if (!isChannelListRow(row)) return record;
    const json = JSON.stringify(row);
    if (cached?.json === json) {
      cached.version = version;
      return cached.row;
    }
    rows.set(raw, { version, json, row });
    return row;
  };
}
