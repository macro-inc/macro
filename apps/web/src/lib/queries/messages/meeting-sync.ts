import {
  useRefreshTrackedEntitiesOnFocus,
  useReopenTrackedEntitiesOnReconnect,
} from '@service-connection/client';
import type { Accessor } from 'solid-js';
import { useQuerySync } from '../sync/use-query-sync';

/** Meeting pages mount outside the app shell but still receive account message events. */
export function useMeetingMessageSync(userId: Accessor<string | undefined>) {
  useQuerySync(userId);
  useReopenTrackedEntitiesOnReconnect();
  useRefreshTrackedEntitiesOnFocus();
}
