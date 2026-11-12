/**
 * @vitest-environment jsdom
 *
 * The app shell hands a `ui_command` frame addressed to this tab to the open,
 * and on mobile (the native apps and phone-size touch browsers) hands it none.
 */

import type { FromWebsocketMessage } from '@service-connection/websocket';
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appRoutesManifest } from '../tests/app-routes';
import { AgentNavigationProvider } from './agent-navigation';

const USER = 'macro|owner@example.com';
const TAB = '0198a4cc-e138-7670-a308-a6b7666027c1';
const DOC = '0198a4cc-e138-7670-a308-a6b766602799';

const socket = vi.hoisted(() => ({
  deliver: undefined as ((message: FromWebsocketMessage) => void) | undefined,
}));
const device = vi.hoisted(() => ({ nativeApp: false, phoneBrowser: false }));
const applyOpen = vi.hoisted(() => vi.fn(async () => ({ kind: 'shown' })));

vi.mock('@service-connection/websocket', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@service-connection/websocket')>()),
  createConnectionWebsocketEffect: (
    callback: (message: FromWebsocketMessage) => void
  ) => {
    socket.deliver = callback;
  },
  parseWebsocketPayload: (_type: string, data: unknown) => data,
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: true }),
}));
vi.mock('@app/lib/analytics/analytics', () => ({
  analytics: { track: vi.fn() },
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => USER }));
vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => undefined,
}));
vi.mock('@app/lib/split-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@app/lib/split-router')>()),
  useOptionalSplitRouter: () => router,
}));
vi.mock('../primitives/apply-ui-command', () => ({ applyOpen }));
vi.mock('@core/mobile/isNativeMobilePlatform', () => ({
  isNativeMobilePlatform: () => device.nativeApp,
}));
vi.mock('@core/mobile/isMobile', () => ({
  isMobile: () => device.phoneBrowser,
}));

const router = { routes: appRoutesManifest(), settled: async () => {} };

// The tab's id from an earlier prompt in this tab.
sessionStorage.setItem('macro.ui-client-id', TAB);

/** An agent's open for the document, addressed to this person and tab. */
const FRAME_FOR_THIS_TAB: FromWebsocketMessage = {
  type: 'ui_command',
  data: {
    commandId: '0198a4cc-e138-7670-a308-a6b7666027aa',
    userId: USER,
    clientId: TAB,
    sessionId: '0198a4cc-e138-7670-a308-a6b766602700',
    agentName: 'Research agent',
    kind: 'open',
    path: `/md/${DOC}`,
    placement: 'beside-agent',
  },
};

afterEach(() => {
  cleanup();
  applyOpen.mockClear();
  device.nativeApp = false;
  device.phoneBrowser = false;
});

describe('AgentNavigationProvider', () => {
  it('opens what a frame addressed to this tab asks for', () => {
    render(() => <AgentNavigationProvider />);

    socket.deliver?.(FRAME_FOR_THIS_TAB);

    expect(applyOpen).toHaveBeenCalledOnce();
    expect(applyOpen.mock.calls[0]).toContainEqual(
      expect.objectContaining({ clientId: TAB, path: `/md/${DOC}` })
    );
  });

  it.each(['nativeApp', 'phoneBrowser'] as const)(
    'opens nothing on mobile (%s), even for a frame addressed to this tab',
    (kind) => {
      device[kind] = true;
      render(() => <AgentNavigationProvider />);

      socket.deliver?.(FRAME_FOR_THIS_TAB);

      expect(applyOpen).not.toHaveBeenCalled();
    }
  );
});
