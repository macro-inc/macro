import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { type Accessor, createMemo } from 'solid-js';
import type { ActivityContext } from '../context/activity-context';
import type { ActivityEvent } from '../core/event';
import { createEntityActivityQuery } from '../queries/entity-query';

export type EntityActivityView =
  | { t: 'loading' }
  | { t: 'error' }
  | { t: 'empty' }
  | { t: 'ready'; events: ActivityEvent[] };

export type EntityActivityState = {
  view: Accessor<EntityActivityView>;
  /** False for entity types the soup query cannot address. */
  isEnabled: Accessor<boolean>;
};

/**
 * The side-panel Activity section as data. An entity the soup does not
 * know about reads as an error, not as an empty history.
 */
export function createEntityActivityState(
  context: Pick<ActivityContext, 'graphql'>,
  options: { entityId: Accessor<string>; entityType: Accessor<EntityType> }
): EntityActivityState {
  const query = createEntityActivityQuery(context, {
    entityType: options.entityType,
    entityId: options.entityId,
    enabled: () => true,
  });

  const view = createMemo<EntityActivityView>(() => {
    if (query.result.isLoading) return { t: 'loading' };
    if (query.result.isError) return { t: 'error' };
    const data = query.result.data;
    if (!data || data.kind === 'entity-missing') return { t: 'error' };
    if (data.events.length === 0) return { t: 'empty' };
    return { t: 'ready', events: data.events };
  });

  return { view, isEnabled: query.isEnabled };
}
