import { describe, expect, it } from 'vitest';
import {
  BLOCKABLE_NOTIFICATION_EVENT_TYPES,
  EMAIL_DIGEST_NOTIFICATION_TYPE,
  mutedEntityTypeLabel,
  NOTIFICATION_EVENT_GROUPS,
} from '../notification-event-catalog';

/** Types the API will accept on disable. Digest is a channel, not an event row. */
const SERVICE_BLOCKABLE_TYPES = [
  EMAIL_DIGEST_NOTIFICATION_TYPE,
  'new_email',
  'ai_response',
  'channel_message_send',
  'channel_mention',
  'channel_message_reply',
  'document_mention',
  'github_pr_status_changed',
  'github_review_requested',
  'github_pr_comment',
  'github_pr_mention',
  'github_pr_review',
  'task_assigned',
  'mentioned_in_document_comment',
  'replied_to_document_comment_thread',
  'commented_on_document',
  'calendar_event_reminder',
] as const;

describe('notification event catalog', () => {
  it('lists each event type once', () => {
    expect(new Set(BLOCKABLE_NOTIFICATION_EVENT_TYPES).size).toBe(
      BLOCKABLE_NOTIFICATION_EVENT_TYPES.length
    );
  });

  it('only includes types the service can disable', () => {
    for (const type of BLOCKABLE_NOTIFICATION_EVENT_TYPES) {
      expect(SERVICE_BLOCKABLE_TYPES).toContain(type);
    }
  });

  it('covers every blockable inbox event', () => {
    const catalog = new Set(BLOCKABLE_NOTIFICATION_EVENT_TYPES);
    for (const type of SERVICE_BLOCKABLE_TYPES) {
      if (type === EMAIL_DIGEST_NOTIFICATION_TYPE) continue;
      expect(catalog.has(type)).toBe(true);
    }
  });

  it('keeps digest out of event groups', () => {
    expect(BLOCKABLE_NOTIFICATION_EVENT_TYPES).not.toContain(
      EMAIL_DIGEST_NOTIFICATION_TYPE
    );
    expect(
      NOTIFICATION_EVENT_GROUPS.some((group) =>
        group.events.some(
          (event) => event.type === EMAIL_DIGEST_NOTIFICATION_TYPE
        )
      )
    ).toBe(false);
  });

  it('labels known muted entity types', () => {
    expect(mutedEntityTypeLabel('channel')).toBe('Channel');
    expect(mutedEntityTypeLabel('custom_thing')).toBe('custom thing');
  });
});
