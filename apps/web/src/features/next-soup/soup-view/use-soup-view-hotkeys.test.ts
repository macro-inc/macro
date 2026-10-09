import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  enter: undefined as ((event?: KeyboardEvent) => boolean) | undefined,
  open: vi.fn(),
}));

vi.mock('@app/constants/hotkeys', () => ({
  GO_TO_COMMAND_SCOPE: 'go-to',
  GO_TO_LEADER_KEY: 'g',
}));
vi.mock('@app/features/command/state', () => ({
  CommandState: { isOpen: () => false },
}));
vi.mock('@app/features/next-soup/sidebar/soup-filter-presets', () => ({
  VIEW_TAB_PRESETS: {},
}));
vi.mock('@app/features/next-soup/utils', () => ({
  markChannelNotificationsSeenOnOpen: vi.fn(),
  markCalendarNotificationSeenOnOpen: vi.fn(),
  openEntityInSplitFromUnifiedList: mocks.open,
}));
vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ track: vi.fn() }),
}));
vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => undefined,
}));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalNotificationSource: () => ({}),
}));
vi.mock('@core/hotkey/hotkeys', () => ({
  createHotkeyGroup: () => ({ dispose: vi.fn() }),
  registerHotkey: (options: {
    hotkey: string | string[];
    keyDownHandler?: (event?: KeyboardEvent) => boolean;
  }) => {
    if (Array.isArray(options.hotkey) && options.hotkey[0] === 'enter') {
      mocks.enter = options.keyDownHandler;
    }
    return { withGroup: vi.fn() };
  },
}));
vi.mock('@core/hotkey/utils', () => ({ isScopeInActiveBranch: () => true }));
vi.mock('@entity', () => ({
  filterNotDoneNotifications: vi.fn(),
  filterValidNotifications: vi.fn(),
  isSearchEntity: () => false,
  isWithNotification: () => false,
}));
vi.mock('@notifications', () => ({ openSingleStackNotification: vi.fn() }));
vi.mock('./soup-view-tabs', () => ({
  VIEW_TAB_LISTS: {},
  useVisibleViewTabs: () => () => [],
}));

import { useSoupViewHotkeys } from './use-soup-view-hotkeys';

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  mocks.open.mockClear();
});

function mountHotkeys() {
  createRoot((cleanup) => {
    dispose = cleanup;
    useSoupViewHotkeys({
      scopeId: 'reminder-native-action-test',
      soup: {
        focus: {
          row: () => ({
            getIsGrouped: () => false,
            getIsLoadMore: () => false,
          }),
          item: () => ({ type: 'email', id: 'thread' }),
        },
      },
      splitHandle: {},
      currentView: () => 'mail',
    } as unknown as Parameters<typeof useSoupViewHotkeys>[0]);
  });
}

describe('native reminder Enter activation', () => {
  it('yields without preventing the native button default or opening its row', () => {
    mountHotkeys();
    const button = document.createElement('button');
    button.setAttribute('data-reminder-action', '');
    const icon = button.appendChild(document.createElement('span'));
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      cancelable: true,
    });
    let handled: boolean | undefined;
    icon.addEventListener('keydown', (event) => {
      handled = mocks.enter?.(event as KeyboardEvent);
    });
    icon.dispatchEvent(event);
    expect(handled).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    'retains row navigation (keyboard event: %s)',
    (keyboard) => {
      mountHotkeys();
      const event = keyboard
        ? new KeyboardEvent('keydown', { key: 'Enter' })
        : undefined;
      expect(mocks.enter?.(event)).toBe(true);
      expect(mocks.open).toHaveBeenCalledOnce();
    }
  );
});
