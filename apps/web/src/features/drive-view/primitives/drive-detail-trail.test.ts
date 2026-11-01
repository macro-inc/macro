import {
  createRoutesManifest,
  decodePane,
  routeParams,
} from '@app/lib/split-router';
import {
  appRoute,
  driveFolderDocumentRoute,
  driveFolderRoute,
  driveRootDocumentRoute,
  driveSplitRoute,
  homeDocumentRoute,
  homePreviewRoute,
  homeSplitRoute,
} from '@app/routes/routes';
import { describe, expect, it, vi } from 'vitest';
import {
  detailRouteFromTarget,
  detailTargetFromRoute,
  driveDetailTrailSchema,
} from './drive-detail-trail';

vi.mock('@service-storage/websocket', () => ({
  storageWS: { reconnectIfDisconnected: vi.fn() },
  createWebSocketJob: vi.fn(),
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), send: vi.fn() },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect: vi.fn(),
  createConnectionWebsocketEffect: vi.fn(),
}));

const routes = createRoutesManifest({
  definitions: [
    {
      ...appRoute,
      children: [
        {
          ...driveSplitRoute,
          children: [
            { ...driveFolderRoute, children: [driveFolderDocumentRoute] },
            driveRootDocumentRoute,
          ],
        },
        {
          ...homeSplitRoute,
          children: [homeDocumentRoute, homePreviewRoute],
        },
      ],
    },
  ],
  defaultRoute: () => ({ matches: [{ id: 'app', params: {} }] }),
});

const leaf = (path: string) => {
  const route = decodePane(routes, path.split('/'));
  return route && { id: route.matches.at(-1)?.id, ...routeParams(route) };
};

describe('Drive details for databases and forms', () => {
  it.each(['database', 'form'] as const)(
    'opens a %s inline in Drive and keeps Home on its block preview',
    (type) => {
      expect(leaf(`drive/${type}/item-1`)).toMatchObject({
        id: 'drive-document',
        documentType: type,
        documentId: 'item-1',
      });
      expect(leaf(`drive/folder/folder-1/${type}/item-1`)).toMatchObject({
        id: 'drive-folder-document',
        documentType: type,
      });
      expect(leaf(`home/${type}/item-1`)).toMatchObject({
        id: 'home-preview',
        blockType: type,
      });
    }
  );

  it.each(['database', 'form'] as const)(
    'round-trips a %s between its route and its trail entry',
    (type) => {
      const target = detailTargetFromRoute({ id: 'item-1', type });

      expect(target).toEqual({ type, id: 'item-1' });
      expect(detailRouteFromTarget(target!)).toEqual({ id: 'item-1', type });
      expect(driveDetailTrailSchema.safeParse([target]).success).toBe(true);
    }
  );

  it('keeps document subtypes on their markdown file type', () => {
    const snippet = detailTargetFromRoute({ id: 'doc-1', type: 'snippet' });

    expect(snippet).toEqual({
      type: 'document',
      id: 'doc-1',
      fileType: 'md',
      subType: { type: 'snippet' },
    });
    expect(detailRouteFromTarget(snippet!)).toEqual({
      id: 'doc-1',
      type: 'snippet',
    });
  });
});
