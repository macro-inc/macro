import type { QueryKey } from '@tanstack/solid-query';
import { botKeys, botProfileKeys } from './bots/keys';
import { channelKeys } from './channel/keys';
import { historyKeys } from './history/keys';
import { notificationKeys } from './notification/keys';
import { soupKeys } from './soup/keys';
import { databasesKeys, formsKeys } from './storage/keys';
import { teamKeys } from './team/keys';

/**
 * Query keys, and key prefixes, whose endpoints serve only the signed-in
 * user's own data. Root providers mount them on every route, signed-out
 * pages included, so they wait for a session instead of collecting 401s.
 *
 * List a whole family only when no member serves a shared link or a signed-out
 * page; otherwise list the member keys. Form and channel details open from
 * shared links, and GraphQL soup answers anonymous callers.
 */
export const SESSION_ONLY_QUERY_KEYS: readonly QueryKey[] = [
  notificationKeys._def,
  teamKeys._def,
  historyKeys._def,
  soupKeys.items._def,
  botKeys._def,
  botProfileKeys._def,
  channelKeys.listChannels.queryKey,
  channelKeys.activity.queryKey,
  channelKeys.quickAccessGraphql._def,
  databasesKeys.list.queryKey,
  formsKeys.list.queryKey,
];
