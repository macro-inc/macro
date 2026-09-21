import { defineRoute, routeParams } from '@app/lib/split-router/routes';
import type {
  SplitRouteMatch,
  SplitRouteParams,
  SplitRouterEntry,
} from '@app/split-router';
import { URL_PARAMS as MARKDOWN_URL_PARAMS } from '@block-md/constants';
import { URL_PARAMS as PDF_URL_PARAMS } from '@block-pdf/constants';
import { z } from 'zod';
import type { DriveLocation, DriveTab } from '../core/types';

type DriveContentIdentity = { type: string; id: string };
type DriveRootContent = {
  type: 'component';
  id: 'documents';
  entryMetadata?: {
    route: { matches: [SplitRouteMatch, ...SplitRouteMatch[]] };
  };
};

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

const driveDocumentTypes = new Set<string>(DRIVE_DOCUMENT_TYPES);

function driveDocumentBlockType(type: string) {
  if (type === 'task' || type === 'snippet' || type === 'skill') return 'md';
  if (type === 'csv') return 'code';
  return type;
}

function isDriveTab(value: unknown): value is DriveTab {
  return value === 'owned' || value === 'recent' || value === 'shared';
}

function isDriveDocumentType(value: unknown): value is DriveDocumentType {
  return typeof value === 'string' && driveDocumentTypes.has(value);
}

export type DriveRouteParams = SplitRouteParams & {
  tab?: DriveTab;
  view?: 'folder';
  folderId?: string;
  documentId?: string;
  documentType?: DriveDocumentType;
};

export type DriveDocumentRoute = {
  id: string;
  type: DriveDocumentType;
};

export function driveLocationFromParams(
  params: DriveRouteParams
): DriveLocation {
  if (params.view === 'folder') {
    return { kind: 'folder', id: params.folderId ?? null };
  }

  return {
    kind: 'tab',
    tab: isDriveTab(params.tab) ? params.tab : 'owned',
  };
}

export function driveDocumentFromParams(
  params: DriveRouteParams
): DriveDocumentRoute | undefined {
  if (!params.documentId || !isDriveDocumentType(params.documentType)) return;

  return {
    id: params.documentId,
    type: params.documentType,
  };
}

function driveLocationParams(location: DriveLocation): DriveRouteParams {
  if (location.kind === 'folder') {
    return {
      view: 'folder',
      folderId: location.id ?? undefined,
    };
  }

  return location.tab === 'owned' ? {} : { tab: location.tab };
}

function driveParams(
  location: DriveLocation,
  document?: DriveDocumentRoute
): DriveRouteParams {
  return {
    ...driveLocationParams(location),
    documentId: document?.id,
    documentType: document?.type,
  };
}

function driveLocationMatch(
  location: DriveLocation
): SplitRouteMatch | undefined {
  if (location.kind === 'folder') {
    return { id: 'drive-folder', params: driveLocationParams(location) };
  }
  if (location.tab !== 'owned') {
    return { id: 'drive-tab', params: driveLocationParams(location) };
  }
}

function driveDocumentMatchId(location: DriveLocation): string {
  if (location.kind === 'folder') return 'drive-folder-document';
  return location.tab === 'owned' ? 'drive-document' : 'drive-tab-document';
}

export function driveSplitContent(
  location: DriveLocation,
  document?: DriveDocumentRoute
): DriveRootContent {
  const matches: SplitRouteMatch[] = [{ id: 'drive', params: {} }];
  const locationMatch = driveLocationMatch(location);
  if (locationMatch) matches.push(locationMatch);
  if (document) {
    matches.push({
      id: driveDocumentMatchId(location),
      params: {
        documentId: document.id,
        documentType: document.type,
      },
    });
  }

  return {
    type: 'component',
    id: 'documents',
    entryMetadata: {
      route: {
        matches: matches as [SplitRouteMatch, ...SplitRouteMatch[]],
      },
    },
  };
}

export function drivePath(
  location: DriveLocation,
  document?: DriveDocumentRoute
): string {
  const params = driveParams(location, document);
  const segments = ['drive'];

  if (params.view === 'folder') {
    segments.push('folder');
    if (params.folderId) segments.push(params.folderId);
  } else if (params.tab && params.tab !== 'owned') {
    segments.push(params.tab);
  }

  if (params.documentType && params.documentId) {
    segments.push(params.documentType, params.documentId);
  }

  return `/${segments.map(encodeURIComponent).join('/')}`;
}

export function driveDocumentRoute(document: {
  id: string;
  fileType: string;
  subType?: string;
}): DriveDocumentRoute {
  const blockType = driveDocumentBlockType(
    document.subType ?? document.fileType
  );
  const documentType = isDriveDocumentType(blockType) ? blockType : 'unknown';

  return {
    id: document.id,
    type: documentType,
  };
}

export function driveDocumentFromContent(
  content: DriveContentIdentity
): DriveDocumentRoute | undefined {
  if (content.type === 'component') return;

  const documentType = driveDocumentBlockType(content.type);
  if (!isDriveDocumentType(documentType)) return;

  return {
    id: content.id,
    type: documentType,
  };
}

const documentParams = z.object({
  documentType: z.enum(DRIVE_DOCUMENT_TYPES),
  documentId: z.string().min(1),
});

function driveDocumentRouteDefinition(id: string) {
  return defineRoute({
    id,
    path: ':documentType/:documentId',
    params: documentParams,
    claim: ({ documentType, documentId }) => ({
      namespace: 'block',
      id: `${driveDocumentBlockType(documentType)}:${documentId}`,
    }),
  });
}

const driveFolderRoute = defineRoute({
  id: 'drive-folder',
  path: 'folder/:folderId?',
  params: z
    .object({ folderId: z.string().min(1).optional() })
    .transform(({ folderId }) => ({ view: 'folder' as const, folderId })),
  children: [driveDocumentRouteDefinition('drive-folder-document')],
});

const driveTabRoute = defineRoute({
  id: 'drive-tab',
  path: ':tab',
  aliases: ['tab/:tab'],
  params: z.object({ tab: z.enum(['recent', 'shared']) }),
  children: [driveDocumentRouteDefinition('drive-tab-document')],
});

export const driveSplitRoute = defineRoute({
  id: 'drive',
  path: 'drive',
  aliases: ['drive/owned', 'drive/tab/owned'],
  params: z.object({}),
  claim: () => ({ namespace: 'component', id: 'documents' }),
  search: ['drive'],
  externalSearch: (entry: Readonly<SplitRouterEntry>) => {
    const documentType = routeParams<DriveRouteParams>(
      entry.location?.route
    ).documentType;

    if (
      documentType === 'md' ||
      documentType === 'task' ||
      documentType === 'snippet' ||
      documentType === 'skill'
    ) {
      return Object.values(MARKDOWN_URL_PARAMS);
    }

    return documentType === 'pdf' ? Object.values(PDF_URL_PARAMS) : [];
  },
  children: [
    driveFolderRoute,
    driveTabRoute,
    driveDocumentRouteDefinition('drive-document'),
  ],
});
