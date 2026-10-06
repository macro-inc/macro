import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX, type ParentProps, splitProps } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ListNav } from './list-nav';
import type { SidebarNextNavItem } from './nav-items';
import { SidebarPrefsProvider } from './use-sidebar-prefs';

const mocks = vi.hoisted(() => ({
  setActiveView: (_view: string) => {},
  activeView: (): string => 'settings',
  navigate: vi.fn(),
}));

vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ track: vi.fn() }),
}));
vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => ({
    activeSplit: () => ({
      content: () => ({ type: 'component', id: mocks.activeView() }),
    }),
    returnFocus: vi.fn(),
  }),
}));
vi.mock('@components/app/app-sidebar/sidebar', () => ({
  navigateToSidebarView: mocks.navigate,
  sidebarContent: (id: string) => ({ type: 'component', id }),
  SidebarOpenInSplitMenu: (props: ParentProps) => props.children,
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: vi.fn() }),
}));
vi.mock('@solidjs/router', () => ({
  useLocation: () => ({ pathname: '/app' }),
}));
vi.mock('@ui', async () => ({
  ...(await import('@ui/utils/classname')),
  Button: (
    props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }
  ) => {
    const [local, rest] = splitProps(props, ['label']);
    return <button type="button" aria-label={local.label} {...rest} />;
  },
}));

const Icon = () => <svg aria-hidden="true" />;

const item = (id: string, label: string) =>
  ({
    id,
    label,
    href: `/${id}`,
    icon: Icon,
    iconActive: Icon,
    hotkeyToken: `sidebar.goTo.${id}`,
  }) as unknown as SidebarNextNavItem;

beforeEach(() => {
  vi.useFakeTimers();
  const [activeView, setActiveView] = createSignal('settings');
  mocks.activeView = activeView;
  mocks.setActiveView = setActiveView;
  mocks.navigate.mockReset();
  mocks.navigate.mockImplementation(({ viewId }: { viewId: string }) =>
    setActiveView(viewId)
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ListNav', () => {
  it('does not reclaim the highlight when the view it left becomes active again', () => {
    render(() => (
      <SidebarPrefsProvider>
        <ListNav item={item('home', 'Home')} />
        <ListNav item={item('agents', 'Agents')} />
      </SidebarPrefsProvider>
    ));
    const agents = screen.getByRole('button', { name: 'Agents' });

    fireEvent.mouseDown(agents, { button: 0 });
    // Optimistic: highlighted before the view swaps in.
    expect(agents.hasAttribute('data-active')).toBe(true);

    vi.runAllTimers();
    expect(mocks.navigate).toHaveBeenCalledOnce();
    expect(mocks.activeView()).toBe('agents');
    expect(agents.hasAttribute('data-active')).toBe(true);

    // Settings opens from outside the rail list (the gear, a hotkey).
    mocks.setActiveView('settings');
    expect(agents.hasAttribute('data-active')).toBe(false);
    expect(
      screen.getByRole('button', { name: 'Home' }).hasAttribute('data-active')
    ).toBe(false);
  });
});
