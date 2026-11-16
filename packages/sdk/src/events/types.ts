// Event names and payloads come from the backend's OpenAPI spec
// (`WebhookEvent` in generated/storage/schemas), so this file stays in
// lockstep with what the backend actually delivers. On top of the raw
// `metadata`, handlers get ORM handles for every entity the payload names.

import type { WebhookEvent } from '../../generated/storage/types.gen';
import type { hydrateAgentSessionEvent } from './hydrate/agentSession';
import type { hydrateBotEvent } from './hydrate/bot';
import type { hydrateCalendarEvent } from './hydrate/calendar';
import type { hydrateCallEvent } from './hydrate/call';
import type { hydrateCallRecordEvent } from './hydrate/callRecord';
import type { hydrateChannelEvent } from './hydrate/channel';
import type { hydrateChatEvent } from './hydrate/chat';
import type { hydrateDatabaseEvent } from './hydrate/database';
import type { hydrateDocumentEvent } from './hydrate/document';
import type { hydrateEmailEvent } from './hydrate/email';
import type { hydrateFormEvent } from './hydrate/form';
import type { hydrateInitiativeEvent } from './hydrate/initiative';
import type { hydrateMessageEvent } from './hydrate/message';
import type { hydrateNotificationEvent } from './hydrate/notification';
import type { hydrateProjectEvent } from './hydrate/project';
import type { hydratePropertyEvent } from './hydrate/property';
import type { hydrateUserEvent } from './hydrate/user';

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
 * Every hydrated event the receiver can dispatch, as one discriminated union.
 *
 * The `hydrate*` functions are the single source of truth for which handles
 * ride along with which event — this reads their inferred return types back
 * rather than restating the mapping.
 */
type HydratedEvent =
  | ReturnType<typeof hydrateAgentSessionEvent>
  | ReturnType<typeof hydrateChannelEvent>
  | ReturnType<typeof hydrateCallEvent>
  | ReturnType<typeof hydrateCallRecordEvent>
  | ReturnType<typeof hydrateChatEvent>
  | ReturnType<typeof hydrateDatabaseEvent>
  | ReturnType<typeof hydrateBotEvent>
  | ReturnType<typeof hydrateCalendarEvent>
  | ReturnType<typeof hydrateEmailEvent>
  | ReturnType<typeof hydrateNotificationEvent>
  | ReturnType<typeof hydratePropertyEvent>
  | ReturnType<typeof hydrateFormEvent>
  | ReturnType<typeof hydrateInitiativeEvent>
  | ReturnType<typeof hydrateProjectEvent>
  | ReturnType<typeof hydrateDocumentEvent>
  | ReturnType<typeof hydrateMessageEvent>
  | ReturnType<typeof hydrateUserEvent>;

/**
 * What a handler receives, per event: the raw `metadata` plus the ORM handles
 * named by that event's ids. A family with no hydrator yet delivers its raw
 * `metadata` only.
 *
 * Handles are free to construct and load lazily, so hydrating every event costs
 * nothing until a handler reads a field or calls a method on one.
 */
export type EventMap = {
  [E in EventName]: [HydratedFor<E>] extends [never]
    ? Extract<MacroEvent, { event_type: E }>
    : HydratedFor<E>;
};

/**
 * The hydrated shape for one event name. A hydrator arm may serve several
 * names at once (its `event_type` is then a union); this re-narrows
 * `event_type` and `metadata` to the one name.
 */
type HydratedFor<E extends EventName> = NarrowedTo<HydratedEvent, E>;

/** Distributes over the hydrated union, keeping the members `E` matches. */
type NarrowedTo<H, E extends EventName> = H extends { event_type: infer T }
  ? E extends T
    ? Omit<H, 'event_type' | 'metadata'> & {
        event_type: E;
        metadata: EventPayload<E>;
      }
    : never
  : never;

/** An event family, the part of an event name before the dot. */
export type EventFamily = EventName extends `${infer F}.${string}` ? F : never;

/**
 * What `subscribe({ events })` accepts: an event name, a family wildcard
 * such as `'document.*'`, or `'*'` for every event. Wildcards need the
 * `public-event-stream` beta.
 */
export type EventPattern = EventName | `${EventFamily}.*` | '*';

/** The event names a pattern matches. */
export type MatchedEventName<P extends EventPattern> = P extends '*'
  ? EventName
  : P extends `${infer F}.*`
    ? Extract<EventName, `${F}.${string}`>
    : Extract<P, EventName>;

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
