import type { SplitRouteParams } from '@app/split-router';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { z } from 'zod';
import type { DriveLocation, DriveTab } from '../core/types';
import {
  DRIVE_DOCUMENT_TYPES,
  type DriveDocumentType,
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
  const type = documentType.safeParse(
    fileTypeToBlockName(document.subType ?? document.fileType)
  ).data;
  return { id: document.id, type: type ?? 'unknown' };
}

export function driveDocumentFromContent(content: {
  type: string;
  id: string;
}): DriveDocumentRoute | undefined {
  if (content.type === 'component') return;
  const type = documentType.safeParse(fileTypeToBlockName(content.type)).data;
  return type ? { id: content.id, type } : undefined;
}
