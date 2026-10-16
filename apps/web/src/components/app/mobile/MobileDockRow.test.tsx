import { SearchState } from '@app/features/command/mobile/mobileSearchState';
import { enableCalendarScheduling } from '@core/constant/featureFlags';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import type { ParentProps } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MobileDockRow } from './MobileDockRow';
import { isMobileNavViewId } from './mobile-nav-views';

const { navigate, toggleSettings, reviewsFlag, schedulingFlag, foreground } =
  vi.hoisted(() => ({
    navigate: vi.fn(),
    toggleSettings: vi.fn(),
    reviewsFlag: { enabled: false },
    schedulingFlag: { enabled: false },
    foreground: { id: 'tasks' },
  }));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: (flag: unknown) => () =>
    flag === enableCalendarScheduling ? schedulingFlag : reviewsFlag,
}));
vi.mock('@core/constant/SettingsState', () => ({
  useSettingsState: () => ({ settingsOpen: () => false, toggleSettings }),
}));
vi.mock('@core/directive/focusInput', () => ({
  triggerFocusInput: (target: () => HTMLElement | null) => target()?.focus(),
}));
vi.mock('@core/mobile/haptics', () => ({ hapticImpact: vi.fn() }));
vi.mock('@core/mobile/virtualKeyboard', () => ({
  virtualKeyboardVisible: () => false,
}));
vi.mock('@ui', () => ({
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
  Layer: (props: ParentProps) => props.children,
}));
vi.mock('@solid-primitives/resize-observer', () => ({
  createElementSize: () => ({ width: 80, height: 40 }),
}));
vi.mock('./use-mobile-nav', () => ({
  useForegroundMobileView: () => () => foreground.id,
  useMobileNavNavigate: () => navigate,
}));
vi.mock('./mobile-dock-views', () => ({
  useMobileDockViews: () => () => [
    { id: 'calendar', label: 'Calendar', icon: () => <svg /> },
    { id: 'documents', label: 'Files', icon: () => <svg /> },
    { id: 'tasks', label: 'Tasks', icon: () => <svg /> },
    { id: 'calls', label: 'Calls', icon: () => <svg /> },
  ],
}));

let drawerStyles: HTMLStyleElement;
beforeEach(() => {
  // Supply browser motion defaults missing in jsdom for Corvu's presence tracking.
  reviewsFlag.enabled = false;
  schedulingFlag.enabled = false;
  foreground.id = 'tasks';
  drawerStyles = document.createElement('style');
  drawerStyles.textContent =
    '[data-corvu-drawer-content], [data-corvu-drawer-overlay] { transition-duration: 0s; animation-name: none; }';
  document.head.append(drawerStyles);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('scrollTo', vi.fn());
});
afterEach(() => {
  cleanup();
  SearchState.close();
  drawerStyles.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it('mounts and focuses search during the tap before navigating once', () => {
  render(() => <MobileDockRow />);
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  expect(document.activeElement).toBe(screen.getByPlaceholderText('Search…'));
  expect(navigate).toHaveBeenCalledExactlyOnceWith('search');
});

describe('dock overflow drawer', () => {
  it('keeps Settings first, reverses overflow views, and closes after navigation', async () => {
    render(() => <MobileDockRow />);
    const trigger = screen.getByRole('button', { name: 'More views' });
    fireEvent.pointerDown(trigger);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.pointerUp(trigger);
    fireEvent.click(trigger);
    const drawer = within(screen.getByRole('dialog', { name: 'More views' }));
    expect(
      drawer.getAllByRole('button').map((button) => button.textContent)
    ).toEqual(['Settings', 'Calls', 'Tasks', 'Files', 'Views']);
    expect(
      drawer.getByRole('button', { name: 'Tasks' }).getAttribute('aria-current')
    ).toBe('page');
    fireEvent.click(drawer.getByRole('button', { name: 'Files' }));
    expect(navigate).toHaveBeenCalledExactlyOnceWith('documents');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('opens Reviews from More when enabled without adding a dock button', async () => {
    reviewsFlag.enabled = true;
    render(() => <MobileDockRow />);
    expect(screen.queryByRole('button', { name: 'Reviews' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'More views' }));
    const drawer = within(screen.getByRole('dialog', { name: 'More views' }));
    fireEvent.click(drawer.getByRole('button', { name: 'Reviews' }));
    expect(navigate).toHaveBeenCalledExactlyOnceWith('reviews');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('opens Scheduling from More when enabled without adding a dock button', async () => {
    expect(isMobileNavViewId('booking-links')).toBe(true);
    schedulingFlag.enabled = true;
    foreground.id = 'booking-links';
    render(() => <MobileDockRow />);
    expect(screen.queryByRole('button', { name: 'Scheduling' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'More views' }));
    const drawer = within(screen.getByRole('dialog', { name: 'More views' }));
    expect(
      drawer
        .getByRole('button', { name: 'Scheduling' })
        .getAttribute('aria-current')
    ).toBe('page');
    fireEvent.click(drawer.getByRole('button', { name: 'Scheduling' }));
    expect(navigate).toHaveBeenCalledExactlyOnceWith('booking-links');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
  it('closes after opening Settings and supports dismissing without selection', async () => {
    render(() => <MobileDockRow />);
    const trigger = screen.getByRole('button', { name: 'More views' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(toggleSettings).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Views' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(toggleSettings).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });
});
