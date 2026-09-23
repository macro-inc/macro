import {
  groupHomeEntitiesByDate,
  inboxGroupTimestamp,
  mergeHomeEntities,
} from '@app/features/inbox-view/queries/inbox-results';
import type { Notification } from '@entity/types/notification';
import type { SoupApiItem } from '@service-storage/generated/schemas';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearNotifiedFloors,
  raiseNotifiedFloor,
} from './normalized-cache/notified-floor';
import { mapApiSoupItemToEntity } from './transform-utils';

vi.mock('@core/constant/allBlocks', () => ({
  blockNameToDefaultFile: {},
  itemToSafeName: vi.fn(),
}));
vi.mock('@core/context/channels', () => ({ useChannelsContext: vi.fn() }));
vi.mock('@core/user', () => ({ emailToId: vi.fn() }));
vi.mock('@service-storage/websocket', () => ({
  storageWS: { reconnectIfDisconnected: vi.fn() },
  createWebSocketJob: vi.fn(),
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), send: vi.fn() },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect: vi.fn(),
  createConnectionWebsocketEffect: vi.fn(),
}));

const fridayReminder = '2026-09-18T13:50:00Z';
const recentSync = '2026-09-20T17:40:00Z';
const now = new Date('2026-09-20T18:00:00Z');
const context = {
  tab: 'signal' as const,
  capabilities: {
    calendar: true,
    foreignEntities: false,
    notifiedSort: false,
    reminders: false,
    snippets: false,
  },
};

function reminder(createdAt = fridayReminder): Notification {
  return {
    id: `reminder-${createdAt}`,
    entity_id: 'event',
    entity_type: 'calendar_event',
    notification_event_type: 'calendar_event_reminder',
    notification_metadata: {
      tag: 'calendar_event_reminder',
      content: {
        eventId: 'event',
        occurrenceKey: '2026-09-18T14:00:00Z',
        startsAt: '2026-09-18T14:00:00Z',
        title: 'Friday deployment',
        minutesBefore: 10,
      },
    },
    sent: true,
    state: 'unseen',
    created_at: createdAt,
    updated_at: recentSync,
  };
}

function calendarItem(notifications: Notification[] = [reminder()]) {
  return {
    tag: 'calendarEvent',
    frecency_score: 0,
    is_favorited: false,
    data: {
      id: 'event',
      title: 'Friday deployment',
      ownerId: 'macro|owner@example.com',
      status: 'confirmed',
      time: {
        kind: 'timed',
        startsAt: '2026-09-18T14:00:00Z',
        endsAt: '2026-09-18T15:00:00Z',
      },
      isReadOnly: false,
      createdAt: '2026-09-01T12:00:00Z',
      updatedAt: recentSync,
      icalUid: 'event',
      transparency: 'opaque',
      visibility: 'default',
      extra: { properties: [] },
      notifications,
    },
  } satisfies SoupApiItem & { data: { notifications: Notification[] } };
}

afterEach(clearNotifiedFloors);

describe('calendar reminder dates in Home', () => {
  it('keeps a cold Friday reminder out of Last hour after a recent calendar sync', () => {
    // Mapped GraphQL data carries notifications but no notified_at while
    // the server's notification sort is disabled.
    const entity = mapApiSoupItemToEntity(calendarItem());
    const rows = mergeHomeEntities([entity], [], context);
    expect(rows[0].sortTs).toBe(fridayReminder);
    expect(groupHomeEntitiesByDate(rows, now)[0].label).toBe('Last 7 days');
    expect(entity.updatedAt).toBe(recentSync);
  });

  it('uses the latest reminder delivery regardless of array order or read/done state', () => {
    const latest = '2026-09-19T13:50:00Z';
    const item = calendarItem([
      { ...reminder(latest), state: 'done' },
      { ...reminder(fridayReminder), state: 'seen' },
      { ...reminder(recentSync), deleted_at: recentSync },
      reminder('invalid date'),
    ]);
    // The canonical master start can predate a recurring occurrence.
    item.data.time.startsAt = '2026-09-01T14:00:00Z';
    expect(mapApiSoupItemToEntity(item).notifiedAt).toBe(latest);
  });

  it('also uses the REST reminder delivery stamp when notifications are absent', () => {
    const item = calendarItem([]);
    expect(
      mapApiSoupItemToEntity({
        ...item,
        data: { ...item.data, lastReminderFiredAt: fridayReminder },
      }).notifiedAt
    ).toBe(fridayReminder);
  });

  it('preserves explicit server notification ordering and newer live notifications', () => {
    const item = { ...calendarItem(), notified_at: '2026-09-17T12:00:00Z' };
    expect(mapApiSoupItemToEntity(item).notifiedAt).toBe(item.notified_at);
    raiseNotifiedFloor('event', recentSync);
    expect(mapApiSoupItemToEntity(item).notifiedAt).toBe(recentSync);
  });

  it('keeps content recency when no reminder timestamp is available', () => {
    const entity = mapApiSoupItemToEntity(calendarItem([]));
    expect(entity.notifiedAt).toBeUndefined();
    expect(inboxGroupTimestamp(entity, context)).toBe(recentSync);
  });

  it('preserves own-activity ordering and non-notification tabs', () => {
    const entity = mapApiSoupItemToEntity({
      ...calendarItem(),
      touched_at: recentSync,
    });
    expect(mergeHomeEntities([entity], [entity], context)[0].sortTs).toBe(
      recentSync
    );
    expect(inboxGroupTimestamp(entity, { ...context, tab: 'reminders' })).toBe(
      recentSync
    );
  });
});
