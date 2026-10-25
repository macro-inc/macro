import { SearchState } from '@app/features/command/mobile/mobileSearchState';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import { createSignal, type ParentProps } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MobileDockRow } from './MobileDockRow';
import { isMobileNavViewId } from './mobile-nav-views';

const {
  navigate,
  toggleSettings,
  reviewsFlag,
  schedulingFlag,
  foreground,
  unreadViews,
} = vi.hoisted(() => ({
  navigate: vi.fn(),
  toggleSettings: vi.fn(),
  reviewsFlag: { enabled: false },
  schedulingFlag: { enabled: false },
  foreground: { id: 'tasks' },
  unreadViews: { enabled: false },
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'dock-test-user',
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
vi.mock('@ui', async () => ({
  Button: (await import('@ui/components/Button')).Button,
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
  Layer: (props: ParentProps) => props.children,
}));
const [unreadIds, setUnreadIds] = createSignal<string[]>([]);
vi.mock('../use-navigation-unread', () => ({
  useNavigationUnread: () => (id: string) => unreadIds().includes(id),
}));
const [islandWidth, setIslandWidth] = createSignal(80);
vi.mock('@solid-primitives/resize-observer', () => ({
  createElementSize: () => ({
    get width() {
      return islandWidth();
    },
    height: 40,
  }),
}));
vi.mock('./use-mobile-nav', () => ({
  useForegroundMobileView: () => () => foreground.id,
  useMobileNavNavigate: () => navigate,
}));
vi.mock('./mobile-dock-views', () => ({
  MOBILE_DOCK_VIEWS: [
    'home',
    'mail',
    'channels',
    'calendar',
    'documents',
    'tasks',
    'calls',
    'reviews',
    'booking-links',
  ].map((id) => ({ id })),
  useMobileDockViews: () => {
    if (unreadViews.enabled) {
      const views = [
        { id: 'home', label: 'Notifications', icon: () => <svg /> },
        { id: 'mail', label: 'Email', icon: () => <svg /> },
        { id: 'channels', label: 'Channels', icon: () => <svg /> },
        { id: 'documents', label: 'Files', icon: () => <svg /> },
      ];
      return () => views;
    }
    const views = [
      { id: 'calendar', label: 'Calendar', icon: () => <svg /> },
      { id: 'documents', label: 'Files', icon: () => <svg /> },
      { id: 'tasks', label: 'Tasks', icon: () => <svg /> },
      { id: 'calls', label: 'Calls', icon: () => <svg /> },
      ...(reviewsFlag.enabled
        ? [{ id: 'reviews', label: 'Reviews', icon: () => <svg /> }]
        : []),
      ...(schedulingFlag.enabled
        ? [{ id: 'booking-links', label: 'Scheduling', icon: () => <svg /> }]
        : []),
    ];
    return () => views;
  },
}));

let drawerStyles: HTMLStyleElement;
beforeEach(() => {
  // Supply browser motion defaults missing in jsdom for Corvu's presence tracking.
  reviewsFlag.enabled = false;
  schedulingFlag.enabled = false;
  foreground.id = 'tasks';
  unreadViews.enabled = false;
  setUnreadIds([]);
  localStorage.clear();
  setIslandWidth(80);
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
  it('keeps Settings first, shows overflow in saved order, and closes after navigation', async () => {
    render(() => <MobileDockRow />);
    const trigger = screen.getByRole('button', { name: 'More views' });
    fireEvent.pointerDown(trigger);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.pointerUp(trigger);
    fireEvent.click(trigger);
    const drawer = within(screen.getByRole('dialog', { name: 'More views' }));
    expect(
      drawer.getAllByRole('button').map((button) => button.textContent)
    ).toEqual([
      'Settings',
      'Customize dock',
      'Files',
      'Tasks',
      'Calls',
      'Views',
    ]);
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

it('opens customization, updates the measured boundary, and persists keyboard reorders', async () => {
  const mounted = render(() => <MobileDockRow />);
  fireEvent.click(screen.getByRole('button', { name: 'More views' }));
  fireEvent.click(screen.getByRole('button', { name: 'Customize dock' }));
  await screen.findByRole('button', { name: 'Reorder Tasks' });
  const drawer = within(screen.getByRole('dialog', { name: 'Customize dock' }));
  expect(drawer.getByText('In dock · 1')).toBeTruthy();
  expect(drawer.getByText('In More · 3')).toBeTruthy();
  setIslandWidth(120);
  expect(drawer.getByText('In dock · 2')).toBeTruthy();
  expect(drawer.getByText('In More · 2')).toBeTruthy();
  const handle = drawer.getByRole('button', { name: 'Reorder Tasks' });
  handle.focus();
  fireEvent.keyDown(handle, { key: 'ArrowUp' });
  fireEvent.keyDown(handle, { key: 'ArrowUp' });
  expect(document.activeElement).toBe(handle);
  expect(drawer.getByRole('status').textContent).toContain(
    'Tasks moved to position 1, in dock'
  );
  fireEvent.click(drawer.getByRole('button', { name: 'Done' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByRole('button', { name: 'Tasks' })).toBeTruthy();
  mounted.unmount();
  render(() => <MobileDockRow />);
  expect(screen.getByRole('button', { name: 'Tasks' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'More views' }));
  expect(
    within(screen.getByRole('dialog'))
      .getAllByRole('button')
      .map((button) => button.textContent)
  ).toEqual(['Settings', 'Customize dock', 'Files', 'Calls', 'Views']);
});

it('returns from customization to More without navigating', async () => {
  render(() => <MobileDockRow />);
  fireEvent.click(screen.getByRole('button', { name: 'More views' }));
  fireEvent.click(screen.getByRole('button', { name: 'Customize dock' }));
  fireEvent.click(
    await screen.findByRole('button', { name: 'Back to More views' })
  );
  expect(screen.getByRole('dialog', { name: 'More views' })).toBeTruthy();
  expect(navigate).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'Customize dock' })
  );
});

describe('dock unread indicators', () => {
  it('reacts to the shared unread source without clearing indicators just for navigation', () => {
    unreadViews.enabled = true;
    setIslandWidth(160);
    render(() => <MobileDockRow />);
    const notifications = screen.getByRole('button', { name: 'Notifications' });
    const email = screen.getByRole('button', { name: 'Email' });
    const channels = screen.getByRole('button', { name: 'Channels' });
    expect(email.getAttribute('aria-description')).toBeNull();
    setUnreadIds(['home', 'mail', 'channels']);
    for (const button of [notifications, email, channels]) {
      expect(button.getAttribute('aria-description')).toBe('Unread items');
      expect(button.querySelector('[aria-hidden="true"]')).not.toBeNull();
    }
    fireEvent.click(email);
    expect(navigate).toHaveBeenCalledExactlyOnceWith('mail');
    expect(email.getAttribute('aria-description')).toBe('Unread items');
    setUnreadIds(['channels']);
    expect(email.getAttribute('aria-description')).toBeNull();
    expect(notifications.getAttribute('aria-description')).toBeNull();
    expect(channels.getAttribute('aria-description')).toBe('Unread items');
    expect(screen.getByRole('button', { name: 'Email' })).toBe(email);
    expect(
      screen
        .getByRole('button', { name: 'Search' })
        .getAttribute('aria-description')
    ).toBeNull();
    expect(
      screen
        .getByRole('button', { name: 'More views' })
        .getAttribute('aria-description')
    ).toBeNull();
  });

  it('moves unread indicators between the dock and More as capacity and ordering change', async () => {
    unreadViews.enabled = true;
    setUnreadIds(['channels']);
    setIslandWidth(80);
    render(() => <MobileDockRow />);
    const more = screen.getByRole('button', { name: 'More views' });
    expect(more.getAttribute('aria-description')).toBe('Unread items');
    fireEvent.click(more);
    const drawer = within(screen.getByRole('dialog', { name: 'More views' }));
    expect(
      drawer
        .getByRole('button', { name: 'Channels' })
        .getAttribute('aria-description')
    ).toBe('Unread items');
    expect(
      drawer
        .getByRole('button', { name: 'Email' })
        .getAttribute('aria-description')
    ).toBeNull();
    setUnreadIds([]);
    expect(more.getAttribute('aria-description')).toBeNull();
    expect(
      drawer
        .getByRole('button', { name: 'Channels' })
        .getAttribute('aria-description')
    ).toBeNull();
    setUnreadIds(['channels']);
    fireEvent.click(drawer.getByRole('button', { name: 'Views' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    setIslandWidth(160);
    expect(
      screen
        .getByRole('button', { name: 'Channels' })
        .getAttribute('aria-description')
    ).toBe('Unread items');
    expect(more.getAttribute('aria-description')).toBeNull();
    setIslandWidth(80);
    fireEvent.click(more);
    fireEvent.click(screen.getByRole('button', { name: 'Customize dock' }));
    const handle = await screen.findByRole('button', {
      name: 'Reorder Channels',
    });
    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(
      screen
        .getByRole('button', { name: 'Channels' })
        .getAttribute('aria-description')
    ).toBe('Unread items');
    expect(more.getAttribute('aria-description')).toBeNull();
  });
});
