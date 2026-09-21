import type { CustomToastConfig } from '@core/component/Toast/Toast';
import type { UnifiedNotification } from '@notifications/types';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  flag: () => ({ enabled: false }),
  custom: vi.fn((_config: unknown, _options: unknown) => 1),
  dismiss: vi.fn(),
  open: vi.fn(),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => mocks.flag(),
}));
vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => ({ openWithSplit: mocks.open }),
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { custom: mocks.custom, dismiss: mocks.dismiss },
}));
vi.mock('@core/constant/featureFlags', () => ({ enableReminders: {} }));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'test-user',
  useIsAuthenticated: () => () => true,
}));
vi.mock('@core/signal/tabFocus', () => ({ isTabFocused: () => true }));
vi.mock('@macro-inc/lexical-core', () => ({
  markdownToPlainText: (text: string) => text,
}));

import { useReminderAlerts } from './reminder-alerts';

const notification: UnifiedNotification = {
  id: 'delivery-1',
  entity_id: 'reminder-1',
  entity_type: 'reminder',
  created_at: '2026-09-21T10:00:00Z',
  updated_at: '2026-09-21T10:00:00Z',
  state: 'unseen',
  sent: true,
  notification_event_type: 'reminder',
  notification_metadata: {
    tag: 'reminder',
    content: {
      reminderId: 'reminder-1',
      description: 'Follow up',
      scheduledFor: '2026-09-21T10:00:00Z',
    },
  },
};

describe('reminder alert app wiring', () => {
  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('alerts when the flag becomes enabled after hydration and opens reminder details', () => {
    const h = createRoot((dispose) => {
      const [enabled, setEnabled] = createSignal(false);
      mocks.flag = () => ({ enabled: enabled() });
      const source = {
        notifications: () => [notification],
        isLoading: () => false,
        subscribe: () => () => {},
      };
      useReminderAlerts(source);
      return { setEnabled, dispose };
    });
    expect(mocks.custom).not.toHaveBeenCalled();
    h.setEnabled(true);
    expect(mocks.custom).toHaveBeenCalledOnce();
    const config = mocks.custom.mock.calls[0][0] as CustomToastConfig;
    expect(config.actions?.[0].label).toBe('Open reminder');
    config.actions?.[0].onClick();
    expect(mocks.open).toHaveBeenCalledWith({
      type: 'component',
      id: 'reminder-view~reminder-1',
    });
    expect(mocks.dismiss).toHaveBeenCalledWith(1);
    h.dispose();
  });
});
