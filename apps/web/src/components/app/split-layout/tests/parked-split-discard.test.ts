import type { BlockOrchestrator } from '@core/orchestrator';
import { createRoot } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { paneOf } from '../layoutManager';
import { createRoutedSplitLayoutWithRouter } from './fixtures';

vi.mock('../componentRegistry', () => ({
  resolveComponent: vi.fn((id: string, params: Record<string, string>) => ({
    type: 'mock-component',
    id,
    params,
  })),
}));

vi.mock('@core/constant/allBlocks', () => ({
  isBlockAlias: vi.fn(() => false),
  resolveBlockAlias: vi.fn((type: string) => type),
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

const orchestrator = {
  isBlockMounted: vi.fn(() => false),
  createBlockInstance: vi.fn(),
} as unknown as BlockOrchestrator;

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
});

it('forgets a parked split once its pane is discarded', async () => {
  const { manager, router } = createRoot((disposeRoot) => {
    dispose = disposeRoot;
    return createRoutedSplitLayoutWithRouter(orchestrator, '/home', true);
  });
  const [home] = manager.splits();

  // Opening another layout parks the open panes, as leaving a desktop tab does.
  await router.openLayout(router.layoutFromHref('/channels'));
  await vi.waitFor(() =>
    expect(manager.splits().map((split) => split.content.id)).toEqual([
      'channels',
    ])
  );
  expect(manager.splitState(home!.id)?.content.id).toBe('home');

  router.discardPanes([paneOf(home!.id)]);
  expect(manager.splitState(home!.id)).toBeUndefined();
  expect(manager.getSplit(home!.id)).toBeUndefined();
});
