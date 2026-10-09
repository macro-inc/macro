import { testFacets } from '@app/features/soup';
import type { FacetSelection } from '@app/features/soup/filters/facets/types';
import type { EntityData, WithNotification } from '@entity';
import { HOME_FACETS, type HomeFacetContext } from '../home-facets';

/** Rows a Home list shows under its facets, and which rows the read facet
 * has admitted in the current admission scope. */
export type HomeAdmission = {
  readScope: string;
  admittedIds: Set<string>;
  items: WithNotification<EntityData>[];
};

export const emptyHomeAdmission = (): HomeAdmission => ({
  readScope: '',
  admittedIds: new Set<string>(),
  items: [],
});

/**
 * Apply Home's facets. Rows stay admitted after they transition from unread
 * to read, so opening a row under the Unread filter does not yank it away;
 * changing the tab or read filter starts a new admission scope.
 */
export function admitHomeEntities(
  previous: HomeAdmission,
  input: {
    entities: WithNotification<EntityData>[];
    tab: string;
    facets: FacetSelection;
    facetContext: HomeFacetContext;
  }
): HomeAdmission {
  const activeReadFacets = input.facets.read ?? [];
  const readScope = `${input.tab}:${activeReadFacets.join(',')}`;
  const admittedIds =
    previous.readScope === readScope
      ? new Set(previous.admittedIds)
      : new Set<string>();

  if (activeReadFacets.length === 0) {
    for (const entity of input.entities) admittedIds.add(entity.id);
  } else {
    const readSelection = { read: activeReadFacets };
    for (const entity of input.entities) {
      if (testFacets(readSelection, HOME_FACETS, entity, input.facetContext)) {
        admittedIds.add(entity.id);
      }
    }
  }

  const selection = { ...input.facets, read: [] };
  return {
    readScope,
    admittedIds,
    items: input.entities.filter(
      (entity) =>
        admittedIds.has(entity.id) &&
        testFacets(selection, HOME_FACETS, entity, input.facetContext)
    ),
  };
}
