import {
  deserializeFacetSelection,
  normalizeFacetSelection,
} from '@app/features/soup/filters/facets/selection';
import {
  type CreateSearchParamsOptions,
  isSafeName,
  type SerializedSearchParams,
  type SplitRouteParams,
  takeLast,
} from '@app/split-router';
import { z } from 'zod';
import type { DriveLocation, DriveTab } from '../core/types';
import {
  DRIVE_DOCUMENT_TYPES,
  type DriveDocumentType,
  driveDocumentBlockType,
} from './drive-route-schema';

export type DriveDocumentRoute = { id: string; type: DriveDocumentType };
export type DriveRouteParams = SplitRouteParams & {
  tab?: DriveTab;
  view?: 'folder';
  folderId?: string;
  documentId?: string;
  documentType?: DriveDocumentType;
};

const documentType = z.enum(DRIVE_DOCUMENT_TYPES);

export function driveLocationFromParams(
  params: DriveRouteParams
): DriveLocation {
  return params.view === 'folder'
    ? { kind: 'folder', id: params.folderId ?? null }
    : { kind: 'tab', tab: params.tab ?? 'owned' };
}

export function driveDocumentFromParams(
  params: DriveRouteParams
): DriveDocumentRoute | undefined {
  if (!params.documentId || !params.documentType) return;
  return { id: params.documentId, type: params.documentType };
}

/** String URLs are only needed at legacy redirect boundaries. */
export function drivePath(
  location: DriveLocation,
  document?: DriveDocumentRoute
): string {
  const segments = ['drive'];
  if (location.kind === 'folder') {
    segments.push('folder');
    if (location.id) segments.push(location.id);
  } else if (location.tab !== 'owned') segments.push(location.tab);
  if (document) segments.push(document.type, document.id);
  return `/${segments.map(encodeURIComponent).join('/')}`;
}

export function driveDocumentRoute(document: {
  id: string;
  fileType: string;
  subType?: string;
}): DriveDocumentRoute {
  return {
    id: document.id,
    type:
      documentType.safeParse(
        driveDocumentBlockType(document.subType ?? document.fileType)
      ).data ?? 'unknown',
  };
}

export function driveDocumentFromContent(content: {
  type: string;
  id: string;
}): DriveDocumentRoute | undefined {
  const type = documentType.safeParse(
    driveDocumentBlockType(content.type)
  ).data;
  return type ? { id: content.id, type } : undefined;
}

const searchSchema = z.object({
  scope: z.enum(['default', 'all', 'attachments']),
  sort: z.enum(['updated_at', 'created_at', 'viewed_at']),
  facets: z.record(z.string(), z.array(z.string())),
});
export type DriveSearchParams = z.infer<typeof searchSchema>;
const reservedSearchFields = new Set(['scope', 'sort', 'facets']);

export const driveSearch = {
  namespace: 'drive',
  schema: searchSchema,
  defaults: {
    scope: 'default',
    sort: 'updated_at',
    facets: {},
  } as DriveSearchParams,
  serialize(value, { defaults }): SerializedSearchParams | undefined {
    const params: SerializedSearchParams = {};
    if (value.scope !== defaults.scope) params.scope = [value.scope];
    if (value.sort !== defaults.sort) params.sort = [value.sort];
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
    const legacy = takeLast(params.facets);
    const facets =
      legacy === undefined ? {} : deserializeFacetSelection(legacy);
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
      facets: normalizeFacetSelection(facets),
    };
  },
} satisfies CreateSearchParamsOptions<DriveSearchParams>;
