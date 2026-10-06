import { createRoutesManifest, type PaneId } from '@app/lib/split-router';
import { decodePanes, encodePanes } from '@app/lib/split-router/routes/codec';
import { describe, expect, it, vi } from 'vitest';
import {
  agentsRoute,
  appRoute,
  codersRoute,
  homePreviewRoute,
  homeSplitRoute,
  legacyContentRoute,
  reviewsSplitRoute,
} from './routes';

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
        agentsRoute,
        codersRoute,
        { ...homeSplitRoute, children: [homePreviewRoute] },
        legacyContentRoute,
        reviewsSplitRoute,
      ],
    },
  ],
  defaultRoute: () => ({
    matches: [
      { id: appRoute.id, params: {} },
      { id: homeSplitRoute.id, params: {} },
    ],
  }),
});
const reviewState = {
  's0.review.open': 'true',
  's0.review.id': 'review-1',
  's0.review.revision': '7',
  's0.review.target': 'anchor-1',
  's0.review.thread': 'thread-1',
};

function readPanes(path: string, search: string) {
  return decodePanes(routes, { path, search, hash: '' }).panes.map(
    ({ entry }, index) => ({ paneId: `pane-${index}` as PaneId, entry })
  );
}

describe('review links in application routes', () => {
  it.each([
    '/agents/session-1',
    '/coders/session-1',
    '/agent/session-1',
    '/home/agent/session-1',
  ])('retains the exact comparison and thread when committing %s', (path) => {
    const search = new URLSearchParams(reviewState).toString();
    const result = encodePanes(routes, readPanes(path, search), {
      path,
      search: '',
      hash: '',
    });
    expect(result.path).toBe(path);
    expect(Object.fromEntries(new URLSearchParams(result.search))).toEqual(
      reviewState
    );
  });

  it('keeps review state with its session when panes move', () => {
    const path = '/coders/session-1/~/reviews';
    const panes = readPanes(
      path,
      `${new URLSearchParams(reviewState)}&s1.review.open=true`
    );
    const result = encodePanes(routes, panes.toReversed(), {
      path,
      search: '',
      hash: '',
    });
    expect(result.path).toBe('/reviews/~/coders/session-1');
    expect(Object.fromEntries(new URLSearchParams(result.search))).toEqual(
      Object.fromEntries(
        Object.entries(reviewState).map(([key, value]) => [
          key.replace('s0.', 's1.'),
          value,
        ])
      )
    );
  });
});
