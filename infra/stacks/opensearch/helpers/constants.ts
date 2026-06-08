// Aliases — what application code references via SearchIndex/OpenSearchEntityType.
// Aliases are stable; underlying physical indices behind them can be swapped
// during a reindex via the OpenSearch _aliases API.
export const CHANNELS_ALIAS = 'channels';
export const CHATS_ALIAS = 'chats';
export const DOCUMENTS_ALIAS = 'documents';
export const EMAILS_ALIAS = 'emails';
export const CALL_RECORDS_ALIAS = 'call_records';

// Underlying physical indices (versioned). Bump the suffix to roll a new
// version, then swap the alias atomically.
export const CHANNELS_INDEX = 'channels_v2';
export const CHATS_INDEX = 'chats_v1';
export const DOCUMENTS_INDEX = 'documents_v2';
export const EMAILS_INDEX = 'emails_v1';
export const CALL_RECORDS_INDEX = 'call_records_v1';

export const ALIAS_TO_INDEX: Record<string, string> = {
  [CHANNELS_ALIAS]: CHANNELS_INDEX,
  [CHATS_ALIAS]: CHATS_INDEX,
  [DOCUMENTS_ALIAS]: DOCUMENTS_INDEX,
  [EMAILS_ALIAS]: EMAILS_INDEX,
  [CALL_RECORDS_ALIAS]: CALL_RECORDS_INDEX,
};

// Backward-compat shorthands used by older migration scripts. They now point
// at the alias rather than the physical index, so reads/writes go through the
// alias and survive future index swaps.
export const CHANNEL_INDEX = CHANNELS_ALIAS;
export const CHAT_INDEX = CHATS_ALIAS;
export const DOCUMENT_INDEX = DOCUMENTS_ALIAS;
export const EMAIL_INDEX = EMAILS_ALIAS;

export const SHARD_SETTINGS =
  process.env.ENVIRONMENT === 'prod'
    ? {
        number_of_shards: 6,
        number_of_replicas: 2,
        refresh_interval: '30s', // Default is 1s
      }
    : {
        number_of_shards: 3,
        number_of_replicas: 0,
        refresh_interval: '30s', // Default is 1s
      };

// Search slow-log thresholds, applied at index creation so every new physical
// index emits slow logs without a separate configure step. Lowered from the
// OpenSearch 2s/5s defaults: the parent/child join (has_child + inner_hits)
// read path runs a few hundred ms, so a 2s threshold never fires. inner_hits
// cost lands in the fetch phase, so both phases are covered.
export const SLOWLOG_SETTINGS = {
  'index.search.slowlog.threshold.query.warn': '1s',
  'index.search.slowlog.threshold.query.info': '300ms',
  'index.search.slowlog.threshold.fetch.warn': '1s',
  'index.search.slowlog.threshold.fetch.info': '300ms',
  'index.search.slowlog.level': 'info',
};

export const IS_DRY_RUN = process.env.DRY_RUN !== 'false';
