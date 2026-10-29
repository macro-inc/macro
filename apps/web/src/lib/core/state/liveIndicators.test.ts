import { createRenderEffect, createRoot } from 'solid-js';
import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  trackingChange: undefined as ((event: { data: string }) => void) | undefined,
}));
vi.mock('@core/constant/featureFlags', () => ({
  ENABLE_LIVE_INDICATORS: true,
}));
vi.mock('@service-connection/websocket', () => ({ ws: {} }));
vi.mock('@service-connection/presence-telemetry', () => ({
  reportTrackingChange: vi.fn(),
  reportInvalidTrackingChange: vi.fn(),
}));
vi.mock('@macro-inc/collaboration/websocket', () => ({
  createWebsocketEventEffect: (
    _ws: unknown,
    _type: string,
    callback: (event: { data: string }) => void
  ) => {
    mocks.trackingChange = callback;
  },
}));

const { useUserIndicators } = await import('./liveIndicators');

it('re-renders an entity viewers on each change to that entity only', () => {
  const rendered: (string[] | undefined)[] = [];
  const dispose = createRoot((dispose) => {
    const indicators = useUserIndicators(() => 'document-id');
    createRenderEffect(() => rendered.push(indicators()));
    return dispose;
  });

  mocks.trackingChange!({
    data: JSON.stringify({
      entity_id: 'document-id',
      entity_type: 'document',
      user_ids: ['macro|first@example.com'],
    }),
  });
  mocks.trackingChange!({
    data: JSON.stringify({
      entity_id: 'document-id',
      entity_type: 'document',
      user_ids: ['macro|first@example.com', 'macro|second@example.com'],
    }),
  });
  mocks.trackingChange!({
    data: JSON.stringify({
      entity_id: 'other-document-id',
      entity_type: 'document',
      user_ids: [],
    }),
  });
  dispose();

  expect(rendered).toEqual([
    undefined,
    ['macro|first@example.com'],
    ['macro|first@example.com', 'macro|second@example.com'],
  ]);
});
