import {
  deserializeFacetSelection,
  normalizeFacetSelection,
} from '@app/features/soup/filters/facets/selection';
import type { FacetSelection } from '@app/features/soup/filters/facets/types';
import {
  type CreateSearchParamsOptions,
  isSafeName,
  type SerializedSearchParams,
  takeLast,
} from '@app/split-router';
import { z } from 'zod';
import type { DriveScope, DriveSort } from '../core/types';

const RESERVED_FIELDS = ['scope', 'sort', 'facets'];

const driveSearchParamsSchema = z.object({
  scope: z.enum(['default', 'all', 'attachments']),
  sort: z.enum(['updated_at', 'created_at', 'viewed_at']),
  facets: z.record(z.string(), z.array(z.string())),
});

export type DriveSearchParams = {
  scope: DriveScope;
  sort: DriveSort;
  facets: FacetSelection;
};

export const DEFAULT_DRIVE_SEARCH_PARAMS = {
  scope: 'default',
  sort: 'updated_at',
  facets: {},
} satisfies DriveSearchParams;

export function serializeDriveSearchParams(
  value: DriveSearchParams,
  defaults: DriveSearchParams = DEFAULT_DRIVE_SEARCH_PARAMS
): SerializedSearchParams | undefined {
  const params: SerializedSearchParams = {};

  if (value.scope !== defaults.scope) params.scope = [value.scope];
  if (value.sort !== defaults.sort) params.sort = [value.sort];

  for (const [facetId, optionIds] of Object.entries(
    normalizeFacetSelection(value.facets)
  )) {
    if (isSafeName(facetId) && !RESERVED_FIELDS.includes(facetId)) {
      params[facetId] = optionIds;
    }
  }

  return Object.keys(params).length > 0 ? params : undefined;
}

export function deserializeDriveSearchParams(
  params: SerializedSearchParams
): Partial<DriveSearchParams> {
  const scope = takeLast(params.scope);
  const sort = takeLast(params.sort);
  const legacyFacets = takeLast(params.facets);
  const facets: FacetSelection =
    legacyFacets === undefined ? {} : deserializeFacetSelection(legacyFacets);
  let hasFacets = legacyFacets !== undefined;

  for (const [field, value] of Object.entries(params)) {
    if (RESERVED_FIELDS.includes(field)) continue;

    facets[field] = value;
    hasFacets = true;
  }

  return {
    ...(scope === undefined ? {} : { scope: scope as DriveScope }),
    ...(sort === undefined ? {} : { sort: sort as DriveSort }),
    ...(hasFacets ? { facets: normalizeFacetSelection(facets) } : {}),
  };
}

export const driveSearchParamsOptions = {
  namespace: 'drive',
  schema: driveSearchParamsSchema,
  defaults: DEFAULT_DRIVE_SEARCH_PARAMS,
  serialize: (value, context) =>
    serializeDriveSearchParams(value, context.defaults),
  deserialize: deserializeDriveSearchParams,
} satisfies CreateSearchParamsOptions<DriveSearchParams>;
