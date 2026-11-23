/**
 * @vitest-environment jsdom
 *
 * The app shell takes this tab's id, and joins the channel that keeps it to
 * one live tab, only where agent navigation runs: not on a phone, and as soon
 * as the page stops reading as one (device emulation turned off). Its own
 * file, so no earlier test has taken the id.
 */

import { holdScreen } from '@core/agent-session/tests/device';
import { cleanup, render } from '@solidjs/testing-library';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { AgentNavigationProvider } from './agent-navigation';

const pointer = vi.hoisted(() => ({ setTouch: (_touch: boolean) => {} }));

vi.mock('@core/mobile/isTouchDevice', async () => {
  const { createSignal } = await import('solid-js');
  const [touch, setTouch] = createSignal(true);
  pointer.setTouch = setTouch;
  return { isTouchDevice: touch };
});
vi.mock('@core/mobile/isNativeMobilePlatform', () => ({
  isNativeMobilePlatform: () => false,
}));
vi.mock('@service-connection/websocket', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@service-connection/websocket')>()),
  createConnectionWebsocketEffect: () => {},
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: true }),
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => undefined }));

const opened: BroadcastChannel[] = [];

/** Records each channel a page opens. */
class RecordedChannel extends globalThis.BroadcastChannel {
  constructor(name: string) {
    super(name);
    opened.push(this);
  }
}

beforeAll(() => vi.stubGlobal('BroadcastChannel', RecordedChannel));
afterAll(() => vi.unstubAllGlobals());
afterEach(() => {
  cleanup();
  for (const channel of opened.splice(0)) channel.close();
});

it('takes no tab id on a phone, and takes it once the page stops reading as one', () => {
  holdScreen(390, 844);
  render(() => <AgentNavigationProvider />);

  expect(opened).toEqual([]);
  expect(sessionStorage.getItem('macro.ui-client-id')).toBeNull();

  pointer.setTouch(false);

  expect(opened.map((channel) => channel.name)).toEqual(['macro.ui-client']);
  expect(sessionStorage.getItem('macro.ui-client-id')).toMatch(
    /^[0-9a-f-]{36}$/
  );
});
