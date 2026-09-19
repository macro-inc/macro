// Event names and payloads come from the backend's OpenAPI spec
// (`WebhookEvent` in generated/storage/schemas), so this file stays in
// lockstep with what the backend actually delivers. On top of the raw
// `metadata`, handlers get ORM handles for every entity the payload names.

import type { WebhookEvent } from '../../generated/storage/types.gen';
import type { hydrateChannelEvent } from './hydrate/channel';
import type { hydrateDocumentEvent } from './hydrate/document';

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
  | ReturnType<typeof hydrateChannelEvent>
  | ReturnType<typeof hydrateDocumentEvent>;

/**
 * What a handler receives, per event: the raw `metadata` plus the ORM handles
 * named by that event's ids.
 *
 * Handles are free to construct and load lazily, so hydrating every event costs
 * nothing until a handler reads a field or calls a method on one.
 */
export type EventMap = {
  [E in EventName]: Extract<HydratedEvent, { event_type: E }>;
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
