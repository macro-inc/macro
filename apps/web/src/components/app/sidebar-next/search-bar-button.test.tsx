import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import type { ParentProps } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchRailButton } from './search-bar-button';

const mocks = vi.hoisted(() => ({
  activeView: 'home',
  navigate: vi.fn(() => ({ id: 'destination' })),
  focus: vi.fn(),
  returnFocus: vi.fn(),
  command: vi.fn(),
}));

vi.mock('@app/features/command', () => ({
  CommandState: { open: mocks.command },
}));
vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ track: vi.fn() }),
}));
vi.mock('@app/features/next-soup/soup-view/search-controllers', () => ({
  requestSearchFocus: mocks.focus,
}));
vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => ({
    activeSplit: () => ({
      id: 'active',
      content: () => ({ type: 'component', id: mocks.activeView }),
    }),
    returnFocus: mocks.returnFocus,
  }),
}));
vi.mock('@components/app/app-sidebar/sidebar', () => ({
  navigateToSidebarView: mocks.navigate,
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: vi.fn() }),
}));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('@ui/components/Hotkey', () => ({ Hotkey: () => null }));
vi.mock('@ui/components/Tooltip', () => ({
  Tooltip: (props: ParentProps) => props.children,
}));
vi.mock('@ui', async () => ({
  ...(await import('@ui/utils/classname')),
  ...(await import('@ui/utils/menuKeyboardNavigation')),
  ...(await import('@ui/components/Layer')),
  ...(await import('@ui/components/Dropdown')),
}));

let menuStyles: HTMLStyleElement;
beforeEach(() => {
  mocks.activeView = 'home';
  vi.clearAllMocks();
  // jsdom omits the motion defaults used by Kobalte's presence tracking.
  menuStyles = document.createElement('style');
  menuStyles.textContent =
    '[role="menu"] { animation-name: none; transition-duration: 0s; }';
  document.head.append(menuStyles);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('PointerEvent', MouseEvent);
  vi.stubGlobal('scrollTo', vi.fn());
});

afterEach(() => {
  cleanup();
  menuStyles.remove();
  vi.unstubAllGlobals();
});

async function openMenu() {
  render(() => <SearchRailButton />);
  const trigger = screen.getByRole('button', { name: 'Search' });
  fireEvent.keyDown(trigger, { key: 'Enter' });
  return screen.findByRole('menuitem', { name: 'Search everything' });
}

describe.each(['home', 'search'])('search menu from %s', (activeView) => {
  it.each([
    ['pointer', false],
    ['pointer', true],
    ['keyboard', false],
    ['keyboard', true],
  ] as const)(
    'honors %s selection with Shift=%s after dismissal',
    async (input, shiftKey) => {
      mocks.activeView = activeView;
      const item = await openMenu();
      if (input === 'pointer') {
        fireEvent.pointerUp(item, { button: 0, shiftKey });
      } else {
        fireEvent.keyDown(item, { key: 'Enter', shiftKey });
      }
      expect(mocks.focus).not.toHaveBeenCalled();
      await waitFor(() => expect(mocks.focus).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole('menu')).toBeNull();
      if (activeView === 'search' && !shiftKey) {
        expect(mocks.navigate).not.toHaveBeenCalled();
        expect(mocks.focus).toHaveBeenCalledWith('active');
      } else {
        expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ viewId: 'search', shiftKey })
        );
        expect(mocks.focus).toHaveBeenCalledWith('destination');
      }
    }
  );
});

it('dismisses without navigating and still opens the command menu', async () => {
  await openMenu();
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  expect(mocks.navigate).not.toHaveBeenCalled();
  expect(mocks.focus).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole('button', { name: 'Search' }), {
    key: 'Enter',
  });
  fireEvent.keyDown(
    await screen.findByRole('menuitem', { name: /Command Menu/ }),
    { key: 'Enter', shiftKey: true }
  );
  await waitFor(() => expect(mocks.command).toHaveBeenCalledTimes(1));
  expect(mocks.navigate).not.toHaveBeenCalled();
});
