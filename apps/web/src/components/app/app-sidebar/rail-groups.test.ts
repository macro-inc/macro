import { TOKENS } from '@core/hotkey/tokens';
import type { UnifiedNotification } from '@notifications/types';
import { describe, expect, it } from 'vitest';
import type { SidebarItem } from './links';
import {
  formatRailUnreadCount,
  railGroups,
  unreadCountsByLinkId,
} from './rail-groups';

function link(id: string, overrides: Partial<SidebarItem> = {}): SidebarItem {
  return {
    id,
    label: id,
    href: `/${id}`,
    hotkey: 'i',
    hotkeyToken: TOKENS.sidebar.goTo.inbox,
    ...overrides,
  };
}

function notification(
  entityType: UnifiedNotification['entity_type'],
  overrides: Partial<UnifiedNotification> = {}
): UnifiedNotification {
  return {
    id: `${entityType}-${Math.random()}`,
    entity_id: 'entity-1',
    entity_type: entityType,
    created_at: '2026-08-17T00:00:00.000Z',
    done: false,
    notification_event_type: 'test',
    notification_metadata: {
      tag: 'channel_message_send',
    } as UnifiedNotification['notification_metadata'],
    sent: true,
    updated_at: '2026-08-17T00:00:00.000Z',
    viewed_at: null,
    ...overrides,
  };
}

describe('railGroups', () => {
  it('clusters links in the rail order, not the sidebar order', () => {
    const groups = railGroups([
      link('channels'),
      link('mail'),
      link('inbox'),
      link('calendar'),
    ]);

    expect(
      groups.map((group) => [group.id, group.items.map((item) => item.id)])
    ).toEqual([
      ['overview', ['inbox']],
      ['comms', ['mail', 'calendar']],
      ['rooms', ['channels']],
    ]);
  });

  it('drops links hidden from the sidebar', () => {
    const groups = railGroups([
      link('inbox'),
      link('search', { hiddenFromSidebar: true }),
    ]);

    expect(groups).toEqual([
      { id: 'overview', items: [expect.objectContaining({ id: 'inbox' })] },
    ]);
  });

  it('keeps a link no cluster claims, in a trailing cluster', () => {
    const groups = railGroups([link('mail'), link('brand-new-view')]);

    expect(
      groups.map((group) => [group.id, group.items.map((item) => item.id)])
    ).toEqual([
      ['comms', ['mail']],
      ['other', ['brand-new-view']],
    ]);
  });

  it('claims a duplicated link id once', () => {
    // `documents` ships twice — the Files row plus a Documents variant that is
    // hidden from the sidebar but keeps its own hotkey.
    const groups = railGroups([
      link('documents'),
      link('documents', { label: 'Documents' }),
    ]);

    expect(groups).toEqual([
      {
        id: 'work',
        items: [
          expect.objectContaining({ id: 'documents', label: 'documents' }),
        ],
      },
    ]);
  });
});

describe('unreadCountsByLinkId', () => {
  it('counts unread notifications per destination', () => {
    const counts = unreadCountsByLinkId([
      notification('email_thread'),
      notification('email_thread'),
      notification('calendar_event'),
    ]);

    expect(counts.get('mail')).toBe(2);
    expect(counts.get('calendar')).toBe(1);
  });

  it('aggregates every unread notification under the inbox', () => {
    const counts = unreadCountsByLinkId([
      notification('email_thread'),
      notification('channel'),
      // No rail destination of its own — still an unread inbox item.
      notification('team'),
    ]);

    expect(counts.get('inbox')).toBe(3);
    expect(counts.get('team')).toBeUndefined();
  });

  it('counts documents and static files together, as Files does', () => {
    const counts = unreadCountsByLinkId([
      notification('document'),
      notification('static_file'),
    ]);

    expect(counts.get('documents')).toBe(2);
  });

  it('ignores seen, done, and non-message channel notifications', () => {
    const counts = unreadCountsByLinkId([
      notification('email_thread', { viewed_at: '2026-08-18T00:00:00.000Z' }),
      notification('email_thread', { done: true }),
      notification('channel', {
        notification_metadata: {
          tag: 'channel_invite',
        } as UnifiedNotification['notification_metadata'],
      }),
    ]);

    expect(counts.size).toBe(0);
  });

  it('leaves an id with no unread notifications absent', () => {
    expect(unreadCountsByLinkId([]).get('mail')).toBeUndefined();
  });
});

describe('formatRailUnreadCount', () => {
  it('caps the badge so it fits the rail', () => {
    expect(formatRailUnreadCount(9)).toBe('9');
    expect(formatRailUnreadCount(99)).toBe('99');
    expect(formatRailUnreadCount(100)).toBe('99+');
  });
});
