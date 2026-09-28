import { DIFF_SEARCH_PARAM } from '@app/features/agent-changes/core/url-state';
import { createRoutesManifest } from '@app/lib/split-router/routes';
import {
  decodeSplitRouterLocation,
  serializeSplitRouterLocation,
} from '@app/lib/split-router/url';
import { describe, expect, it, vi } from 'vitest';
import { appSplitRoutes } from '../split-router/app-routes';

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

const routes = createRoutesManifest(appSplitRoutes);
const viewerState = `${DIFF_SEARCH_PARAM}=session-1%3Asplit%3Aunified`;

function roundTrip(pathname: string, search: string, committed: boolean) {
  const location = { pathname, search: `?${search}`, hash: '' };
  const { entries } = decodeSplitRouterLocation({ routes, location });
  return serializeSplitRouterLocation({
    routes,
    entries,
    previous: location,
    // A layout change commits without the inbound query; only globally owned
    // keys survive it.
    preserveExternalSearch: !committed,
  });
}

describe('application route search ownership', () => {
  it.each([
    ['/agents/session-1', 'the agents workspace'],
    ['/coders/session-1', 'a coding session'],
    ['/agent/session-1', 'the agent block'],
  ])('keeps the changes viewer state on %s (%s)', (pathname) => {
    expect(roundTrip(pathname, viewerState, false)).toContain(viewerState);
    expect(roundTrip(pathname, viewerState, true)).toContain(viewerState);
  });

  it('keeps a neighbouring pane’s viewer state when one pane navigates', () => {
    const search = `${DIFF_SEARCH_PARAM}=session-1%3Asplit%3Aunified%2Csession-2%3Achanges-only%3Asplit`;
    expect(roundTrip('/agents/session-1/~/mail', search, true)).toContain(
      search
    );
  });

  it('drops search keys no route owns', () => {
    expect(roundTrip('/agents/session-1', 'unowned=1', true)).not.toContain(
      'unowned'
    );
  });
});
