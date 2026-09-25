import type { NotifEvent } from '@service-notification/generated/schemas/notifEvent';

/**
 * Discussion notifications that carry their own discussion metadata: comments
 * on CRM companies and contacts. They name the reason the server chose and the
 * canonical message/thread ids.
 */
export type EntityDiscussionEvent = Extract<
  NotifEvent,
  { tag: 'crm_discussion' }
>;

export function isEntityDiscussionEvent(
  metadata: NotifEvent | undefined
): metadata is EntityDiscussionEvent {
  return metadata?.tag === 'crm_discussion';
}

/** "mentioned you", "replied" or "commented", from the delivery reason. */
export function entityDiscussionVerb(metadata: EntityDiscussionEvent): string {
  switch (metadata.content.reason) {
    case 'mention':
      return 'mentioned you';
    case 'reply':
      return 'replied';
    default:
      return 'commented';
  }
}
