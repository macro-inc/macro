// Event names and payloads come from the backend's OpenAPI spec
// (`WebhookEvent` in generated/storage/schemas), so this file stays in
// lockstep with what the backend actually delivers. Message events
// additionally carry a hydrated `message` ORM handle.

import type { WebhookEvent } from '../../generated/storage/types.gen';
import type { Message } from '../entities/channels/message';

/** A webhook delivery body, exactly as Macro serializes it. */
export type MacroEvent = WebhookEvent;

/** Every entity event name Macro can deliver. */
export type EventName = MacroEvent['event_type'];

/** The raw `metadata` payload delivered with a given event. */
export type EventPayload<E extends EventName> = Extract<
  MacroEvent,
  { event_type: E }
>['metadata'];

/**
 * Events whose payload names a message; handlers get a `message` handle.
 * Derived structurally (payload carries `channel_id` + `message_id`), so a
 * new backend event that names a message is hydrated with no SDK change.
 * The receiver's runtime check mirrors this shape.
 */
export type MessageEventName = {
  [E in EventName]: EventPayload<E> extends {
    channel_id: string;
    message_id: string;
  }
    ? E
    : never;
}[EventName];

export type EventMap = {
  [E in EventName]: E extends MessageEventName
    ? { metadata: EventPayload<E>; message: Message }
    : { metadata: EventPayload<E> };
};

export type EventHandler<E extends EventName> = (
  event: EventMap[E],
) => void | Promise<void>;

/** The headers Macro sends on every webhook delivery. */
export interface DeliveryHeaders {
  event?: string; // X-Macro-Event
  eventId?: string; // X-Macro-Event-Id
  timestamp?: string; // X-Macro-Timestamp
  signature?: string; // X-Macro-Signature
}
