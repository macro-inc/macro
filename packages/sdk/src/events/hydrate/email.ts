import { Link } from '../../entities/email/link';
import { EmailMessage } from '../../entities/email/message';
import { EmailThread } from '../../entities/email/thread';
import type { MacroClient } from '../../utils/client';
import type { MacroEvent } from '../types';

export type EmailEvent = Extract<MacroEvent, { event_type: `email.${string}` }>;

/**
 * Attach the mailbox link and, when the event names them, thread and message
 * handles to an email event.
 */
export function hydrateEmailEvent(client: MacroClient, event: EmailEvent) {
  const { metadata } = event;
  return {
    event_type: event.event_type,
    metadata,
    link: Link.byId(client, metadata.link_id),
    thread:
      'thread_id' in metadata
        ? EmailThread.byId(client, metadata.thread_id)
        : undefined,
    message:
      'message_id' in metadata
        ? EmailMessage.byId(client, metadata.message_id)
        : undefined,
  };
}
