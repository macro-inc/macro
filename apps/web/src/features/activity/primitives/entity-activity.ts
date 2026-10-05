import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { type Accessor, createMemo } from 'solid-js';
import { match, P } from 'ts-pattern';
import type { ActivityContext } from '../context/activity-context';
import type { ActivityEvent } from '../core/event';
import { createDatabaseActivityQuery } from '../queries/database-activity-query';
import { createEntityActivityQuery } from '../queries/entity-query';

/** Entities with an Activity section: Soup entities, and databases. */
export type ActivitySectionEntityType = EntityType | 'DATABASE';

export type EntityActivityView =
  | { t: 'loading' }
  | { t: 'error' }
  | { t: 'empty' }
  | { t: 'ready'; events: ActivityEvent[] };

export type EntityActivityState = {
  view: Accessor<EntityActivityView>;
  /** False for entity types the activity queries cannot address. */
  isEnabled: Accessor<boolean>;
};

/**
 * The side-panel Activity section as data. An entity the soup does not
 * know about reads as an error, not as an empty history. The entity type
 * picks the query, so it is fixed for the section's lifetime.
 */
export function createEntityActivityState(
  context: Pick<ActivityContext, 'graphql'>,
  options: { entityId: Accessor<string>; entityType: ActivitySectionEntityType }
): EntityActivityState {
  const query = match(options.entityType)
    .with('DATABASE', () =>
      createDatabaseActivityQuery(context, {
        databaseId: options.entityId,
        enabled: () => true,
      })
    )
    .with(P.not('DATABASE'), (entityType) =>
      createEntityActivityQuery(context, {
        entityType: () => entityType,
        entityId: options.entityId,
        enabled: () => true,
      })
    )
    .exhaustive();

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
