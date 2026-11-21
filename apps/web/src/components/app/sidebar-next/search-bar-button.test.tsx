import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchRailButton } from './search-bar-button';

const mocks = vi.hoisted(() => ({
  activeView: 'home',
  navigate: vi.fn(() => ({ id: 'destination' })),
  focus: vi.fn(),
  returnFocus: vi.fn(),
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
vi.mock('../split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: vi.fn() }),
}));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('@ui/components/Hotkey', () => ({ Hotkey: () => null }));

beforeEach(() => {
  mocks.activeView = 'home';
  vi.clearAllMocks();
});

afterEach(cleanup);

describe.each(['home', 'search'])('search button from %s', (activeView) => {
  it.each([false, true])('opens Search directly with Shift=%s', (shiftKey) => {
    mocks.activeView = activeView;
    render(() => <SearchRailButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Search' }), {
      shiftKey,
    });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(mocks.focus).toHaveBeenCalledTimes(1);
    expect(mocks.returnFocus).toHaveBeenCalledTimes(1);
    if (activeView === 'search' && !shiftKey) {
      expect(mocks.navigate).not.toHaveBeenCalled();
      expect(mocks.focus).toHaveBeenCalledWith('active');
    } else {
      expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ viewId: 'search', shiftKey })
      );
      expect(mocks.focus).toHaveBeenCalledWith('destination');
    }
  });
});
