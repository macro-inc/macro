import {
  deserializeFacetSelection,
  normalizeFacetSelection,
} from '@app/features/soup/filters/facets/selection';
import {
  type CreateSearchParamsOptions,
  createSearchParamsCodec,
  isSafeName,
  type SerializedSearchParams,
  takeLast,
} from '@app/split-router';
import { z } from 'zod';

const searchSchema = z.object({
  scope: z.enum(['default', 'all', 'attachments']),
  sort: z.enum(['updated_at', 'created_at', 'viewed_at']),
  facets: z.record(z.string(), z.array(z.string())),
  commentId: z.string(),
});
export type DriveSearchParams = z.infer<typeof searchSchema>;
const reservedSearchFields = new Set(['scope', 'sort', 'facets', 'commentId']);

export const driveSearch = {
  namespace: 'drive',
  schema: searchSchema,
  defaults: {
    scope: 'default',
    sort: 'updated_at',
    facets: {},
    commentId: '',
  } as DriveSearchParams,
  serialize(value, { defaults }): SerializedSearchParams | undefined {
    const params: SerializedSearchParams = {};
    if (value.scope !== defaults.scope) params.scope = [value.scope];
    if (value.sort !== defaults.sort) params.sort = [value.sort];
    if (value.commentId !== defaults.commentId)
      params.commentId = [value.commentId];
    for (const [field, values] of Object.entries(
      normalizeFacetSelection(value.facets)
    )) {
      if (isSafeName(field) && !reservedSearchFields.has(field))
        params[field] = values;
    }
    return Object.keys(params).length ? params : undefined;
  },
  deserialize(params) {
    const scope = takeLast(params.scope);
    const sort = takeLast(params.sort);
    const commentId = takeLast(params.commentId);
    const legacy = takeLast(params.facets);
    const facets: Record<string, string[]> =
      legacy === undefined ? {} : deserializeFacetSelection(legacy);
    delete facets.commentId;
    for (const [field, values] of Object.entries(params)) {
      if (!reservedSearchFields.has(field)) facets[field] = values;
    }
    return {
      ...(scope === undefined
        ? {}
        : { scope: scope as DriveSearchParams['scope'] }),
      ...(sort === undefined
        ? {}
        : { sort: sort as DriveSearchParams['sort'] }),
      ...(commentId === undefined ? {} : { commentId }),
      facets: normalizeFacetSelection(facets),
    };
  },
} satisfies CreateSearchParamsOptions<DriveSearchParams>;

export const driveSearchCodec = createSearchParamsCodec(driveSearch);
