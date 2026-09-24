/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, For } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { useCreateMenuBlocks } from './Launcher';

const mocks = vi.hoisted(() => ({
  enabled: undefined as (() => boolean) | undefined,
  navigate: vi.fn(),
}));
vi.mock('@app/features/meetings/use-quick-calls-flag', () => ({
  useQuickCallsFlag: () => () => ({ enabled: mocks.enabled?.() ?? false }),
}));
vi.mock(
  '@app/features/block-spreadsheet/primitives/use-spreadsheet-access',
  () => ({
    useSpreadsheetAccess: () => () => false,
  })
);
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: false }),
}));
vi.mock('@solidjs/router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@solidjs/router')>()),
  useNavigate: () => mocks.navigate,
}));
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.enabled = undefined;
});

it('updates the real shared Create command list when the quick-call flag resolves', () => {
  const [enabled, setEnabled] = createSignal(false);
  mocks.enabled = enabled;
  render(() => {
    const blocks = useCreateMenuBlocks();
    return (
      <For each={blocks()}>
        {(block) => (
          <button type="button" onClick={() => block.keyDownHandler()}>
            {block.label}
          </button>
        )}
      </For>
    );
  });
  expect(screen.queryByRole('button', { name: 'Call' })).toBeNull();
  setEnabled(true);
  fireEvent.click(screen.getByRole('button', { name: 'Call' }));
  expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith('/meet/new');
  setEnabled(false);
  expect(screen.queryByRole('button', { name: 'Call' })).toBeNull();
});
