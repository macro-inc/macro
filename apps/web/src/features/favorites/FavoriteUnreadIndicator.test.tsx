import { render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { FavoriteUnreadIndicator } from './FavoriteUnreadIndicator';

const mocks = vi.hoisted(() => ({
  flag: vi.fn(),
  notificationsByEntity: vi.fn(() => ({})),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => mocks.flag,
}));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalNotificationSource: () => ({
    notificationsByEntity: mocks.notificationsByEntity,
  }),
}));
vi.mock('@queries/notification/entity-notifications', () => ({
  useEntityNotifications: () => () => [],
}));

it('does not start the global notification feed while the GraphQL flag loads or is enabled', () => {
  const [flag, setFlag] = createSignal({ loading: true, enabled: false });
  mocks.flag.mockImplementation(flag);
  const view = render(() => (
    <FavoriteUnreadIndicator
      favorite={{
        entityId: 'favorite',
        entityType: 'document',
        sortOrder: 0,
        createdAt: '2026-01-01T00:00:00Z',
      }}
    />
  ));
  expect(mocks.notificationsByEntity).not.toHaveBeenCalled();
  setFlag({ loading: false, enabled: true });
  expect(mocks.notificationsByEntity).not.toHaveBeenCalled();
  setFlag({ loading: false, enabled: false });
  expect(mocks.notificationsByEntity).toHaveBeenCalledOnce();
  view.unmount();
});
