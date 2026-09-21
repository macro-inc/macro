import {
  deserializeFacetSelection,
  normalizeFacetSelection,
} from '@app/features/soup/filters/facets/selection';
import { defineRoute, routeParams } from '@app/lib/split-router/routes';
import {
  type CreateSearchParamsOptions,
  isSafeName,
  type SerializedSearchParams,
  type SplitRouteNavigationTarget,
  type SplitRouteParams,
  type SplitRouterEntry,
  takeLast,
} from '@app/split-router';
import { URL_PARAMS as MARKDOWN_URL_PARAMS } from '@block-md/constants';
import { URL_PARAMS as PDF_URL_PARAMS } from '@block-pdf/constants';
import { z } from 'zod';
import type { DriveLocation, DriveTab } from '../core/types';

export const DRIVE_DOCUMENT_TYPES = [
  'md',
  'task',
  'skill',
  'snippet',
  'canvas',
  'pdf',
  'code',
  'csv',
  'image',
  'video',
  'spreadsheet',
  'unknown',
] as const;
export type DriveDocumentType = (typeof DRIVE_DOCUMENT_TYPES)[number];
export type DriveDocumentRoute = { id: string; type: DriveDocumentType };
export type DriveRouteParams = SplitRouteParams & {
  tab?: DriveTab;
  view?: 'folder';
  folderId?: string;
  documentId?: string;
  documentType?: DriveDocumentType;
};

function documentBlockType(type: string) {
  if (type === 'task' || type === 'snippet' || type === 'skill') return 'md';
  return type === 'csv' ? 'code' : type;
}

const documentType = z.enum(DRIVE_DOCUMENT_TYPES);
const documentParams = z.object({
  documentType,
  documentId: z.string().min(1),
});

function documentRoute<const TId extends string>(id: TId) {
  return defineRoute({
    id,
    path: ':documentType/:documentId',
    params: documentParams,
    claim: ({ documentType, documentId }) => ({
      namespace: 'block',
      id: `${documentBlockType(documentType)}:${documentId}`,
    }),
  });
}

const rootDocument = documentRoute('drive-document');
const folderDocument = documentRoute('drive-folder-document');
const tabDocument = documentRoute('drive-tab-document');
const folderRoute = defineRoute({
  id: 'drive-folder',
  path: 'folder/:folderId?',
  params: z
    .object({ folderId: z.string().min(1).optional() })
    .transform(({ folderId }) => ({ view: 'folder' as const, folderId })),
  children: [folderDocument],
});
const tabRoute = defineRoute({
  id: 'drive-tab',
  path: ':tab',
  aliases: ['tab/:tab'],
  params: z.object({ tab: z.enum(['recent', 'shared']) }),
  children: [tabDocument],
});

export const driveSplitRoute = defineRoute({
  id: 'drive',
  path: 'drive',
  aliases: ['drive/owned', 'drive/tab/owned'],
  params: z.object({}),
  // Drive lists are independent workspaces, not singleton content. Only the
  // document children claim content; returning to a list must stay in its pane.
  search: ['drive'],
  externalSearch: (entry: Readonly<SplitRouterEntry>) => {
    const type = routeParams<DriveRouteParams>(
      entry.location.route
    ).documentType;
    if (
      type === 'md' ||
      type === 'task' ||
      type === 'snippet' ||
      type === 'skill'
    ) {
      return Object.values(MARKDOWN_URL_PARAMS);
    }
    return type === 'pdf' ? Object.values(PDF_URL_PARAMS) : [];
  },
  children: [folderRoute, tabRoute, rootDocument],
});

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

type DriveDestination = SplitRouteNavigationTarget<
  | typeof driveSplitRoute
  | typeof folderRoute
  | typeof tabRoute
  | typeof rootDocument
  | typeof folderDocument
  | typeof tabDocument
>;

/** One typed destination builder for list and detail navigation. */
export function driveDestination(
  location: DriveLocation,
  document?: DriveDocumentRoute
): DriveDestination {
  const detail = document && {
    documentId: document.id,
    documentType: document.type,
  };
  if (location.kind === 'folder') {
    const params = {
      view: 'folder' as const,
      folderId: location.id ?? undefined,
    };
    return detail
      ? { route: folderDocument, params: { ...params, ...detail } }
      : { route: folderRoute, params };
  }
  if (location.tab !== 'owned') {
    const params = { tab: location.tab };
    return detail
      ? { route: tabDocument, params: { ...params, ...detail } }
      : { route: tabRoute, params };
  }
  return detail
    ? { route: rootDocument, params: detail }
    : { route: driveSplitRoute, params: {} };
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
        documentBlockType(document.subType ?? document.fileType)
      ).data ?? 'unknown',
  };
}

export function driveDocumentFromContent(content: {
  type: string;
  id: string;
}): DriveDocumentRoute | undefined {
  const type = documentType.safeParse(documentBlockType(content.type)).data;
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
