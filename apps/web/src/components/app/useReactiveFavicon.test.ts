import type { NotificationSource } from '@notifications';
import { createRoot } from 'solid-js';
import { beforeEach, expect, it, vi } from 'vitest';
import { useReactiveFavicon } from './useReactiveFavicon';

const mocks = vi.hoisted(() => ({
  tauri: false,
  updateFavicon: vi.fn(),
  subscribeBadge: vi.fn(() => () => {}),
}));

vi.mock('@core/util/platform', () => ({ isTauri: () => mocks.tauri }));
vi.mock('@app/util/favicon', () => ({ updateFavicon: mocks.updateFavicon }));
vi.mock('@theme/signals/themeSignals', () => ({
  committedThemeAccent: () => 'accent',
}));
vi.mock('@core/cross-tab/cross-tab-bus', () => ({
  createCrossTabBus: () => ({
    publish: vi.fn(),
    subscribe: mocks.subscribeBadge,
  }),
}));

function mountFavicon() {
  const notifications = {
    subscribe: vi.fn(() => () => {}),
  } as unknown as NotificationSource;
  const dispose = createRoot((dispose) => {
    useReactiveFavicon(notifications);
    return dispose;
  });
  return { notifications, dispose };
}

beforeEach(() => {
  vi.clearAllMocks();
});

it('draws and badges the favicon in a browser tab', () => {
  mocks.tauri = false;
  const { notifications, dispose } = mountFavicon();

  expect(mocks.updateFavicon).toHaveBeenCalledWith('accent', 'accent', false);
  expect(mocks.subscribeBadge).toHaveBeenCalledOnce();
  expect(notifications.subscribe).toHaveBeenCalledOnce();
  dispose();
});

it('does no favicon work in a native webview', () => {
  mocks.tauri = true;
  const { notifications, dispose } = mountFavicon();

  expect(mocks.updateFavicon).not.toHaveBeenCalled();
  expect(mocks.subscribeBadge).not.toHaveBeenCalled();
  expect(notifications.subscribe).not.toHaveBeenCalled();
  dispose();
});
