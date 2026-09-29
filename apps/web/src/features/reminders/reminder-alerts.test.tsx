import type { CustomToastConfig } from '@core/component/Toast/Toast';
import type { UnifiedNotification } from '@notifications/types';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  flag: () => ({ enabled: false }),
  custom: vi.fn((_config: unknown, _options: unknown) => 1),
  dismiss: vi.fn(),
  open: vi.fn(),
  openReminder: vi.fn(),
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
vi.mock('./reminder-navigation', () => ({
  openReminderDetail: mocks.openReminder,
}));
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
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('alerts when the flag becomes enabled after hydration and opens reminder details', () => {
    const h = createRoot((dispose) => {
      const [enabled, setEnabled] = createSignal(false);
      mocks.flag = () => ({ enabled: enabled() });
      const source = {
        notifications: vi.fn(() => [notification]),
        isLoading: vi.fn(() => false),
        subscribe: vi.fn(() => () => {}),
        mutedEntities: () => [],
        _notificationsQuery: { isStarted: true },
      };
      useReminderAlerts(source);
      return { setEnabled, source, dispose };
    });
    expect(mocks.custom).not.toHaveBeenCalled();
    expect(h.source.notifications).not.toHaveBeenCalled();
    expect(h.source.isLoading).not.toHaveBeenCalled();
    expect(h.source.subscribe).not.toHaveBeenCalled();
    h.setEnabled(true);
    expect(mocks.custom).toHaveBeenCalledOnce();
    const config = mocks.custom.mock.calls[0][0] as CustomToastConfig;
    expect(config.actions?.[0].label).toBe('Open reminder');
    config.actions?.[0].onClick();
    expect(mocks.openReminder).toHaveBeenCalledWith('reminder-1', {
      manager: expect.objectContaining({ openWithSplit: mocks.open }),
    });
    expect(mocks.dismiss).toHaveBeenCalledWith(1);
    h.dispose();
  });

  it('adopts notification state overrides when their transport flag hydrates', () => {
    const h = createRoot((dispose) => {
      mocks.flag = () => ({ enabled: true });
      const [useOverrides, setUseOverrides] = createSignal(false);
      let receive: ((item: UnifiedNotification) => void) | undefined;
      useReminderAlerts({
        notifications: () => [],
        isLoading: () => false,
        _notificationsQuery: { isStarted: false },
        mutedEntities: () => [],
        subscribe: (callback) => {
          receive = callback;
          return () => {};
        },
        get withLocalOverrides() {
          return useOverrides()
            ? (item: UnifiedNotification): UnifiedNotification => ({
                ...item,
                state: 'done',
              })
            : undefined;
        },
      });
      return {
        dispose,
        setUseOverrides,
        deliver: () => receive?.(notification),
      };
    });
    h.deliver();
    expect(mocks.custom).toHaveBeenCalledOnce();
    h.setUseOverrides(true);
    expect(mocks.dismiss).toHaveBeenCalledWith(1);
    h.setUseOverrides(false);
    expect(mocks.custom).toHaveBeenCalledTimes(2);
    h.dispose();
  });

  it('alerts while the tab is visible even when the window is blurred', () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    expect(document.hasFocus()).toBe(false);
    mocks.flag = () => ({ enabled: true });
    window.dispatchEvent(new Event('blur'));

    const dispose = createRoot((dispose) => {
      useReminderAlerts({
        notifications: () => [notification],
        isLoading: () => false,
        _notificationsQuery: { isStarted: true },
        mutedEntities: () => [],
        subscribe: () => () => {},
      });
      return dispose;
    });

    expect(mocks.custom).toHaveBeenCalledOnce();
    dispose();
  });

  it('defers alerts while hidden and catches up when the tab becomes visible', () => {
    let state: DocumentVisibilityState = 'hidden';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(
      () => state
    );
    mocks.flag = () => ({ enabled: true });

    const dispose = createRoot((dispose) => {
      useReminderAlerts({
        notifications: () => [notification],
        isLoading: () => false,
        _notificationsQuery: { isStarted: true },
        mutedEntities: () => [],
        subscribe: () => () => {},
      });
      return dispose;
    });

    expect(mocks.custom).not.toHaveBeenCalled();
    state = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(mocks.custom).toHaveBeenCalledOnce();
    dispose();
  });

  it('removes its visibility listener when the app owner is disposed', () => {
    const remove = vi.spyOn(document, 'removeEventListener');
    mocks.flag = () => ({ enabled: false });

    const dispose = createRoot((dispose) => {
      useReminderAlerts({
        notifications: () => [],
        isLoading: () => false,
        _notificationsQuery: { isStarted: false },
        mutedEntities: () => [],
        subscribe: () => () => {},
      });
      return dispose;
    });
    dispose();

    expect(remove).toHaveBeenCalledWith(
      'visibilitychange',
      expect.any(Function),
      undefined
    );
  });
});
