import type { EntityActivityQuery } from '@service-storage/graphql/generated/graphql';
import type { ActivityEvent } from '../core/event';
import { decodeActivityEvent } from './decode';

export type EntityActivityResult =
  | { kind: 'found'; events: ActivityEvent[] }
  | { kind: 'entity-missing' };

export function selectEntityActivity(
  data: EntityActivityQuery,
  entityId: string
): EntityActivityResult {
  const item = data.user.soup.items.find((entry) => entry.id === entityId);
  if (!item) return { kind: 'entity-missing' };
  return {
    kind: 'found',
    events: item.activity.map(decodeActivityEvent),
  };
}
