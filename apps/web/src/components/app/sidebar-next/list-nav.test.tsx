import { cleanup, fireEvent, render, waitFor } from '@solidjs/testing-library';
import { type JSX, type ParentProps, splitProps } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ListNav } from './list-nav';
import type { SidebarNextNavItem } from './nav-items';

const mocks = vi.hoisted(() => ({
  activeView: 'inbox',
  navigate: vi.fn(),
  returnFocus: vi.fn(),
  requestHomeStart: vi.fn(() => true),
}));

vi.mock('@app/features/inbox-view/home-controllers', () => ({
  requestHomeStart: mocks.requestHomeStart,
}));
vi.mock('@app/features/agents-view/core/route', () => ({
  parseAgentsRoute: () => undefined,
}));
vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ track: vi.fn() }),
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
  sidebarContent: (id: string, params?: unknown) => ({
    type: 'component',
    id,
    params,
  }),
  SidebarOpenInSplitMenu: (props: ParentProps) => props.children,
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: vi.fn() }),
}));
vi.mock('@solidjs/router', () => ({
  useLocation: () => ({ pathname: '/app/inbox' }),
}));
vi.mock('@ui', () => ({
  cn: (...parts: unknown[]) => parts.filter(Boolean).join(' '),
  Button: (
    props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
      label: string;
      children?: JSX.Element;
    }
  ) => {
    const [, rest] = splitProps(props, [
      'label',
      'children',
      // Not native attributes; kept off the DOM element.
      'variant',
      'size',
      'tooltip',
      'tooltipPlacement',
      'hotkey',
    ] as never[]);
    return (
      <button type="button" aria-label={props.label} {...rest}>
        {props.children}
      </button>
    );
  },
}));
vi.mock('./nav-glyph', () => ({ NavGlyph: () => null }));
vi.mock('./unread-dot', () => ({ SidebarUnreadDot: () => null }));

const HOME: SidebarNextNavItem = {
  id: 'inbox',
  label: 'Home',
  href: '/inbox',
  icon: () => null,
  iconActive: () => null,
  hotkeyToken: 'sidebar.goTo.inbox' as never,
};

const DRIVE: SidebarNextNavItem = {
  ...HOME,
  id: 'documents',
  label: 'Drive',
  href: '/documents',
};

beforeEach(() => {
  mocks.activeView = 'inbox';
  vi.clearAllMocks();
});
afterEach(cleanup);

function press(item: SidebarNextNavItem, init: MouseEventInit = {}) {
  const view = render(() => <ListNav item={item} />);
  const button = view.getByRole('button', { name: item.label });
  fireEvent.mouseDown(button, { button: 0, ...init });
  return button;
}

describe('pressing the Home rail button', () => {
  it('returns the active Home view to its start pane instead of reopening it', () => {
    press(HOME);
    expect(mocks.requestHomeStart).toHaveBeenCalledExactlyOnceWith('active');
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.returnFocus).toHaveBeenCalledTimes(1);
  });

  it('opens Home when another view is active', async () => {
    mocks.activeView = 'documents';
    press(HOME);
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ viewId: 'inbox', shiftKey: false })
      )
    );
    expect(mocks.requestHomeStart).not.toHaveBeenCalled();
  });

  it('still opens a new split on shift-press while Home is active', async () => {
    press(HOME, { shiftKey: true });
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ viewId: 'inbox', shiftKey: true })
      )
    );
    expect(mocks.requestHomeStart).not.toHaveBeenCalled();
  });
});

it('re-pressing another active view leaves it alone', () => {
  mocks.activeView = 'documents';
  press(DRIVE);
  expect(mocks.requestHomeStart).not.toHaveBeenCalled();
  expect(mocks.navigate).not.toHaveBeenCalled();
  expect(mocks.returnFocus).toHaveBeenCalledTimes(1);
});
