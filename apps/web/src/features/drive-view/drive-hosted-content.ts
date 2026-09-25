import type { SplitLocation, SplitRouteMatch } from '@app/lib/split-router';
import type { SplitContent } from '@components/app/split-layout/layoutManager';
import type { DriveLocation } from './core/types';
import {
  type DriveDocumentRoute,
  driveDocumentFromContent,
} from './primitives/drive-route';

function driveDocumentContent(
  location: DriveLocation,
  document: DriveDocumentRoute
): SplitContent {
  const matches: [SplitRouteMatch, ...SplitRouteMatch[]] = [
    { id: 'drive', params: {} },
  ];
  if (location.kind === 'folder') {
    matches.push({
      id: 'drive-folder',
      params: { view: 'folder', folderId: location.id ?? undefined },
    });
  } else if (location.tab !== 'owned') {
    matches.push({ id: 'drive-tab', params: { tab: location.tab } });
  }
  matches.push({
    id:
      location.kind === 'folder'
        ? 'drive-folder-document'
        : location.tab === 'owned'
          ? 'drive-document'
          : 'drive-tab-document',
    params: { documentId: document.id, documentType: document.type },
  });
  return {
    type: 'component',
    id: 'documents',
    entryMetadata: { route: { matches } },
  };
}

/** Construct Drive-owned split content before the layout mounts a block. */
export function driveHostedContent(
  content: { type: string; id: string },
  options: {
    allowDocuments: boolean;
    search?: SplitLocation['search'];
  }
): SplitContent | undefined {
  const document = options.allowDocuments
    ? driveDocumentFromContent(content)
    : undefined;
  if (document)
    return driveDocumentContent({ kind: 'tab', tab: 'owned' }, document);
  if (content.type !== 'call') return;

  return {
    type: 'component',
    id: 'documents',
    entryMetadata: {
      route: {
        matches: [
          { id: 'drive', params: {} },
          { id: 'drive-call', params: { callId: content.id } },
        ],
      },
      ...(options.search ? { search: options.search } : {}),
    },
  };
}
