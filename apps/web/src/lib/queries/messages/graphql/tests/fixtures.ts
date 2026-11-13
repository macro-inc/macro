import type {
  Message,
  MessageListItem,
  MessageParent,
  MessageTimelineEntry,
  MessageTimelinePage,
  TimelineActivity,
} from '@service-storage/messages';
import type { MessageTimelineData } from '../../timeline';

export const CHANNEL: MessageParent = { type: 'channel', id: 'channel-1' };

/** Minute `at` of a fixed hour, so a larger number is a later row. */
export function at(minute: number): string {
  return `2026-11-12T10:${String(minute).padStart(2, '0')}:00Z`;
}

export function reply(id: string, rootId: string, minute: number): Message {
  return {
    id,
    parent: CHANNEL,
    thread_id: rootId,
    kind: 'message',
    sender_id: 'macro|sender@example.com',
    guest_name: null,
    imported_author: null,
    bot_profile: null,
    mentions: [],
    triggered_by: null,
    triggered_via: null,
    content: `reply ${id}`,
    created_at: at(minute),
    updated_at: at(minute),
    edited_at: null,
    deleted_at: null,
    attachments: [],
    reactions: [],
  };
}

export function root(
  id: string,
  minute: number,
  overrides: Partial<MessageListItem> = {}
): MessageListItem {
  return {
    ...reply(id, id, minute),
    thread_id: null,
    content: `root ${id}`,
    state: {
      root_id: id,
      user_id: 'macro|sender@example.com',
      resolved: false,
      anchor: null,
      created_at: at(minute),
      updated_at: at(minute),
      deleted_at: null,
    },
    thread: { reply_count: 0, latest_reply_at: null, preview: [] },
    ...overrides,
  };
}

export function messageEntry(
  id: string,
  minute: number,
  overrides: Partial<MessageListItem> = {}
): MessageTimelineEntry {
  return { type: 'message', message: root(id, minute, overrides) };
}

export function activity(id: string, minute: number): TimelineActivity {
  return {
    id,
    actor_id: 'macro|sender@example.com',
    occurred_at: at(minute),
    action: 'member_joined',
    payload: null,
  };
}

/** Entries newest first, as the timeline keeps a page. */
export function page(
  entries: MessageTimelineEntry[],
  bounds: Partial<
    Pick<MessageTimelinePage, 'next_cursor' | 'previous_cursor'>
  > = {}
): MessageTimelinePage {
  return { entries, next_cursor: null, previous_cursor: null, ...bounds };
}

export function timeline(...pages: MessageTimelinePage[]): MessageTimelineData {
  return { pages, pageParams: pages.map(() => null) };
}

export function ids(data: MessageTimelineData | undefined): string[][] {
  return (data?.pages ?? []).map((loaded) =>
    loaded.entries.map((entry) =>
      entry.type === 'activity'
        ? `activity:${entry.activity.id}`
        : entry.message.id
    )
  );
}
