import type { EntityData } from '@entity';
import type { SoupAstItemsQueryArgs } from '@queries/soup/items';
import { DRIVE_FACETS } from '../../drive-view/filters/drive-facets';
import { EMAIL_FACETS } from '../../email-view/filters/email-facets';
import {
  externalCallFilter,
  internalCallFilter,
} from '../../next-soup/filters/call-audience';
import {
  compileFacets,
  EMPTY_TAG_FACET_CONTEXT,
  mergeAst,
  type TagFacetContext,
  testFacets,
} from '../../soup';
import type { CrmActivityViewState } from '../core/activity-view';
import type { CrmSoupActivityTab } from '../core/navigation';
import { crmActivityBody } from './activity-filter';

/** Refine, never replace, the fixed CRM and entity-type predicates. */
export function buildCrmActivityQuery(
  tab: CrmSoupActivityTab,
  options?: CrmActivityViewState,
  facetContext: TagFacetContext = EMPTY_TAG_FACET_CONTEXT
): SoupAstItemsQueryArgs {
  const base = crmActivityBody(tab);
  const facets = options?.facets ?? {};
  const refinements =
    tab === 'email'
      ? compileFacets(facets, EMAIL_FACETS, facetContext)
      : compileFacets(facets, DRIVE_FACETS, facetContext);
  return {
    params: {
      limit: 100,
      sort_method: options?.sort ?? 'updated_at',
      sort_direction: options?.direction ?? 'desc',
    },
    body: { ...base, ...mergeAst(base, refinements) },
  };
}

/** Attachment and audience predicates mirror the ordinary Email and Calls lists. */
export function crmActivityItemMatches(
  entity: EntityData,
  tab: CrmSoupActivityTab,
  options: CrmActivityViewState,
  facetContext: TagFacetContext
): boolean {
  if (tab === 'email') {
    return (
      entity.type === 'email' &&
      testFacets(options.facets, EMAIL_FACETS, entity, facetContext)
    );
  }
  if (!testFacets(options.facets, DRIVE_FACETS, entity, facetContext))
    return false;
  if (tab !== 'calls') return true;
  const audience = options.facets.audience?.[0];
  if (audience === 'call-external') return externalCallFilter(entity);
  if (audience === 'call-internal') return internalCallFilter(entity);
  return true;
}
