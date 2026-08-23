/**
 * @vitest-environment jsdom
 */

import { TOKENS } from '@core/hotkey/tokens';
import type { UnifiedNotification } from '@notifications/types';
import { fireEvent, render } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SidebarItem } from './links';
import { SkinnySidebarRail } from './skinny-rail';

const mocks = vi.hoisted(() => ({
  links: [] as SidebarItem[],
  notifications: [] as UnifiedNotification[],
  openWithSplit: vi.fn(),
  pathname: '/',
  track: vi.fn(),
}));

vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ track: mocks.track }),
}));

vi.mock('@app/signal/splitLayout', () => ({
  // Nothing has claimed a split yet, so the active view comes from the path.
  globalSplitManager: () => undefined,
}));

vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalNotificationSource: () => ({
    notifications: () => mocks.notifications,
  }),
}));

vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: mocks.openWithSplit }),
}));

vi.mock('@core/constant/SettingsState', () => ({
  useSettingsState: () => ({
    openSettings: vi.fn(),
    selectTab: vi.fn(),
    settingsOpen: () => false,
  }),
}));

vi.mock('@core/constant/settingsTabsConfig', () => ({
  useSettingsTabAvailable: () => () => true,
}));

vi.mock('@solidjs/router', () => ({
  useLocation: () => ({
    get pathname() {
      return mocks.pathname;
    },
  }),
}));

vi.mock('./links', () => ({
  useSidebarLinks: () => () => mocks.links,
}));

vi.mock('@ui', () => {
  type MockButtonProps = {
    children?: JSX.Element;
    label?: string;
    onClick?: () => void;
    onMouseDown?: (event: MouseEvent) => void;
    onPointerEnter?: () => void;
    onPointerLeave?: () => void;
    'data-active'?: string;
    'data-rail-link'?: string;
  };

  const Button = (props: MockButtonProps) => (
    <button
      type="button"
      aria-label={props.label}
      data-active={props['data-active']}
      data-rail-link={props['data-rail-link']}
      onClick={() => props.onClick?.()}
      onMouseDown={(event) => props.onMouseDown?.(event)}
      onPointerEnter={() => props.onPointerEnter?.()}
      onPointerLeave={() => props.onPointerLeave?.()}
    >
      {props.children}
    </button>
  );

  return { Button, cn: (...args: unknown[]) => args.filter(Boolean).join(' ') };
});

function link(id: string, label: string): SidebarItem {
  return {
    id,
    label,
    href: `/${id}`,
    hotkey: 'i',
    hotkeyToken: TOKENS.sidebar.goTo.inbox,
  };
}

function unreadEmail(id: string): UnifiedNotification {
  return {
    id,
    entity_id: `thread-${id}`,
    entity_type: 'email_thread',
    created_at: '2026-08-17T00:00:00.000Z',
    done: false,
    notification_event_type: 'test',
    notification_metadata: {} as UnifiedNotification['notification_metadata'],
    sent: true,
    updated_at: '2026-08-17T00:00:00.000Z',
    viewed_at: null,
  };
}

function renderRail() {
  const onExpand = vi.fn();
  const onPeekChange = vi.fn();
  const rendered = render(() => (
    <SkinnySidebarRail onExpand={onExpand} onPeekChange={onPeekChange} />
  ));
  return { ...rendered, onExpand, onPeekChange };
}

describe('SkinnySidebarRail', () => {
  beforeEach(() => {
    mocks.links = [];
    mocks.notifications = [];
    mocks.pathname = '/';
    mocks.openWithSplit.mockClear();
  });

  it('renders one icon per destination, clustered', () => {
    mocks.links = [
      link('inbox', 'Inbox'),
      link('mail', 'Email'),
      link('calendar', 'Calendar'),
      link('channels', 'Channels'),
    ];

    const { container } = renderRail();

    const groups = [...container.querySelectorAll('[data-rail-group]')].map(
      (group) => [
        group.getAttribute('data-rail-group'),
        [...group.querySelectorAll('[data-rail-link]')].map((item) =>
          item.getAttribute('data-rail-link')
        ),
      ]
    );

    expect(groups).toEqual([
      ['overview', ['inbox']],
      ['comms', ['mail', 'calendar']],
      ['rooms', ['channels']],
    ]);
  });

  it('badges a destination with its unread count', () => {
    mocks.links = [link('mail', 'Email'), link('calendar', 'Calendar')];
    mocks.notifications = [unreadEmail('a'), unreadEmail('b')];

    const { container } = renderRail();

    const mail = container.querySelector('[data-rail-link="mail"]');
    const calendar = container.querySelector('[data-rail-link="calendar"]');
    expect(mail?.textContent).toBe('2');
    expect(calendar?.textContent).toBe('');
  });

  it('marks the destination the current path is showing', () => {
    mocks.links = [link('mail', 'Email'), link('calendar', 'Calendar')];
    mocks.pathname = '/app/mail';

    const { container } = renderRail();

    const hasActiveAttribute = (linkId: string) =>
      container
        .querySelector(`[data-rail-link="${linkId}"]`)
        ?.hasAttribute('data-active');

    expect(hasActiveAttribute('mail')).toBe(true);
    expect(hasActiveAttribute('calendar')).toBe(false);
  });

  it('opens a destination on click', () => {
    mocks.links = [link('mail', 'Email')];

    const { container } = renderRail();
    const mail = container.querySelector('[data-rail-link="mail"]');
    if (!mail) throw new Error('missing mail rail link');
    fireEvent.mouseDown(mail);

    expect(mocks.openWithSplit).toHaveBeenCalledWith(
      { type: 'component', id: 'mail', params: undefined },
      expect.objectContaining({ referredFrom: 'sidebar' })
    );
  });

  it('expands the full sidebar from the logo, and peeks it on hover', () => {
    mocks.links = [link('mail', 'Email')];

    const { getByLabelText, onExpand, onPeekChange } = renderRail();
    const logo = getByLabelText('Expand sidebar');

    fireEvent.pointerEnter(logo);
    expect(onPeekChange).toHaveBeenCalledWith(true);
    fireEvent.pointerLeave(logo);
    expect(onPeekChange).toHaveBeenCalledWith(false);

    fireEvent.click(logo);
    expect(onExpand).toHaveBeenCalled();
  });
});
