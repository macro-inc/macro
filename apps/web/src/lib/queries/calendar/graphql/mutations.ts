import { fireAndForget } from '@core/util/fireAndForget';
import type { OptimisticResponse } from '@graphql-cache/exchange/optimistic';
import { UNKNOWN_CACHE_GENERATION } from '@graphql-cache/generation-mirror';
import {
  type CacheHost,
  executeOptimisticMutation,
  optimisticMutationDispositionOf,
  readRecordsByKeys,
  selectRecords,
} from '@graphql-cache/index';
import type { CalendarEvent } from '@service-calendar/generated/schemas/calendarEvent';
import type { CalendarOccurrenceItem } from '@service-storage/generated/schemas/calendarOccurrenceItem';
import {
  type CalendarEventFieldsFragment,
  CalendarEventFieldsFragmentDoc,
  CalendarEventIdentityFragmentDoc,
  type CalendarMutationPayloadFieldsFragment,
  type CalendarOccurrenceItemFieldsFragment,
  CalendarsDocument,
  CreateCalendarEventDocument,
  type CreateCalendarEventMutation,
  DeleteCalendarEventDocument,
  type DeleteCalendarEventMutation,
  type GraphqlCalendarAttendeeResponseStatus,
  type GraphqlCalendarConferenceChange,
  type GraphqlCalendarDeletionScope,
  type GraphqlCalendarEventTransparency,
  type GraphqlCalendarEventVisibility,
  type GraphqlCalendarOutOfOfficeAutoDeclineMode,
  type GraphqlCalendarRsvpScope,
  type GraphqlCalendarUpdateScope,
  InviteCalendarEventGuestsDocument,
  type InviteCalendarEventGuestsMutation,
  type InviteCalendarEventGuestsMutationVariables,
  RespondToCalendarEventDocument,
  type RespondToCalendarEventMutation,
  SetCalendarColorDocument,
  type SetCalendarColorMutation,
  UpdateCalendarEventDocument,
  type UpdateCalendarEventMutation,
} from '@service-storage/graphql/generated/graphql';
import {
  getGraphqlSoupCacheHost,
  getGraphqlSoupClient,
} from '@service-storage/graphql-soup';
import type { AnyVariables, Client, OperationResult } from '@urql/core';
import { v4 as uuidv4, v5 as uuidv5 } from 'uuid';
import type {
  CreateCalendarEventArgs,
  DeleteCalendarEventArgs,
  InviteCalendarEventGuestsArgs,
  RsvpCalendarEventArgs,
  UpdateCalendarEventArgs,
} from '../mutations';
import { mapCalendarEvent, mapCalendarOccurrence } from './map';
import {
  deletionPlan,
  graphqlEnum,
  graphqlOccurrenceTimeRecord,
  graphqlReminders,
  graphqlTimeInput,
  graphqlTimeRecord,
  isStandalone,
  occurrenceKeyOf,
  patchedEvent,
  patchedOccurrence,
  withInvitedGuests,
  withRsvp,
} from './optimistic';
import { epochDay, readOccurrenceRecords } from './range';

export type CalendarMutationHost = Pick<
  CacheHost,
  'calendarRange' | 'calendarCommit' | 'readRecordsByKeys'
>;

type EventRecord = CalendarEventFieldsFragment;
type OccurrenceRecord = CalendarOccurrenceItemFieldsFragment;
type Payload = CalendarMutationPayloadFieldsFragment;
type InviteScope = InviteCalendarEventGuestsMutationVariables['input']['scope'];

/** A calendar mutation the server rejected; `code` is the REST error code. */
export class CalendarMutationError extends Error {
  constructor(
    message: string,
    readonly code: string | undefined,
    readonly retryable: boolean
  ) {
    super(message);
    this.name = 'CalendarMutationError';
  }
}

/** Committed with the server's answer, or held by the durable queue. */
export type CalendarMutationOutcome =
  | { kind: 'committed'; payload?: Payload }
  | { kind: 'queued' };

const EVENT_TYPENAME = 'GraphqlCalendarEvent';
const OCCURRENCE_TYPENAME = 'GraphqlCalendarOccurrence';
const PAYLOAD_TYPENAME = 'GraphqlCalendarMutationPayload';
const CALENDAR_TYPENAME = 'GraphqlCalendar';
/** Namespaces RSVP coalescing keys; a newer answer replaces a queued one. */
const RSVP_NAMESPACE = '1b671a64-40d5-491e-99b0-da01ff1f3341';
/** Namespaces calendar color keys; a newer color replaces a queued one. */
const CALENDAR_COLOR_NAMESPACE = '94d6174a-d3d7-4365-8700-6539281e48a4';
/** Every cached occurrence of one event, whatever its date. */
const ALL_TIME = {
  startMs: Date.UTC(1970, 0, 1),
  endMs: Date.UTC(2200, 0, 1),
  startDay: epochDay('1970-01-01'),
  endDay: epochDay('2200-01-01'),
};

const eventKey = (id: string) => `${EVENT_TYPENAME}:${id}`;

const eventSelection = selectRecords(CalendarEventFieldsFragmentDoc);
const eventIdentitySelection = selectRecords(CalendarEventIdentityFragmentDoc);

/** Events saved locally whose create the server has not confirmed yet. */
const pendingCreates = new Set<string>();
/** Creates whose own call still waits for the server's answer. */
const answeringCreates = new Set<string>();
/** The server id each confirmed create replaced its local id with. */
const landedCreates = new Map<string, string>();
/** Confirmed creates whose server id the cache has not been able to tell. */
const unreadCreates = new Set<string>();
/** Reads where a confirmed create landed, from each tracked host. */
const createReaders = new Set<(localId: string) => Promise<void>>();
/**
 * The occurrence each of the latest creates' answers carried for the one
 * drawn locally, by local id: open details move to it before the calendar's
 * own reads draw it. Sign-out reloads the app, which drops them.
 */
const landedReplies = new Map<string, CalendarOccurrenceItem>();
const LANDED_REPLY_LIMIT = 16;
const landedListeners = new Set<(localId: string, serverId: string) => void>();

/** One occurrence of one event: the pair the calendar keys its chips by. */
export interface CalendarOccurrenceRef {
  eventId: string;
  occurrenceKey: string;
}

/**
 * A move made here, as its answer says: a moved event keeps its id, but its
 * occurrence takes the key of its new start, so another occurrence replaces
 * the moved one.
 */
export interface CalendarOccurrenceMove {
  from: CalendarOccurrenceRef;
  to: CalendarOccurrenceRef;
}

const occurrenceRef = (eventId: string, occurrenceKey: string) =>
  JSON.stringify([eventId, occurrenceKey]);

/** How many moves made here of each occurrence the queue holds. */
const movingOccurrences = new Map<string, number>();
const moveListeners = new Set<(move?: CalendarOccurrenceMove) => void>();

/** Whether a move made here of this occurrence still waits for its answer. */
export function isCalendarOccurrenceMoving(
  eventId: string,
  occurrenceKey: string
): boolean {
  return movingOccurrences.has(occurrenceRef(eventId, occurrenceKey));
}

/**
 * Calls `listener` with a move made here once its answer names the
 * occurrence that replaced the moved one, before the calendar drops the
 * moved one, and with nothing once the move is answered or fails.
 */
export function onCalendarOccurrenceMoved(
  listener: (move?: CalendarOccurrenceMove) => void
): () => void {
  moveListeners.add(listener);
  return () => moveListeners.delete(listener);
}

/** A listener's failure must not fail a move the server saved. */
function announceMove(move?: CalendarOccurrenceMove) {
  for (const listener of [...moveListeners]) {
    try {
      listener(move);
    } catch (error) {
      console.warn('Calendar move listener failed', error);
    }
  }
}

function holdMoving(ref: string, change: 1 | -1) {
  const count = (movingOccurrences.get(ref) ?? 0) + change;
  if (count > 0) movingOccurrences.set(ref, count);
  else movingOccurrences.delete(ref);
}

/**
 * The occurrence a time change moves to a new key: a standalone event's only
 * one. A series instance keeps its provider's original start as its key, and
 * a series moved whole moves every instance, so neither is followed.
 */
function movedOccurrence(
  event: EventRecord | undefined,
  occurrences: readonly OccurrenceRecord[],
  patch: UpdateCalendarEventArgs['patch'],
  recurring: boolean
): OccurrenceRecord | undefined {
  if (!patch.time || !event || recurring) return undefined;
  const standalone = occurrences.filter((occurrence) =>
    isStandalone(event, occurrence)
  );
  return standalone.length === 1 ? standalone[0] : undefined;
}

/**
 * The occurrence a committed answer put in place of a standalone event's
 * moved one: its only live occurrence. An answer the queue holds says nothing
 * yet.
 */
function replacingOccurrence(
  result: OperationResult<UpdateCalendarEventMutation>
): OccurrenceRecord | undefined {
  const payload = result.data?.updateCalendarEvent;
  if (
    !payload ||
    result.error ||
    optimisticMutationDispositionOf(result)?.kind === 'queued'
  )
    return undefined;
  const live = payload.occurrences.filter(
    (occurrence) => !occurrence.isCancelled
  );
  return live.length === 1 ? live[0] : undefined;
}

function answeredMove(
  moved: OccurrenceRecord,
  replacing: OccurrenceRecord | undefined
): CalendarOccurrenceMove | undefined {
  // A resize keeps the start, and with it the occurrence.
  if (
    !replacing ||
    occurrenceRef(replacing.eventId, replacing.occurrenceKey) ===
      occurrenceRef(moved.eventId, moved.occurrenceKey)
  )
    return undefined;
  return {
    from: { eventId: moved.eventId, occurrenceKey: moved.occurrenceKey },
    to: { eventId: replacing.eventId, occurrenceKey: replacing.occurrenceKey },
  };
}

/**
 * Holds `moved` while the queue holds its move, and announces where the
 * move's answer put it. Without a moved occurrence it does nothing.
 */
function trackMove(moved: OccurrenceRecord | undefined) {
  const ref = moved && occurrenceRef(moved.eventId, moved.occurrenceKey);
  let held = false;
  return {
    enqueued() {
      if (!ref || held) return;
      held = true;
      holdMoving(ref, 1);
    },
    answered(result: OperationResult<UpdateCalendarEventMutation>) {
      const move = moved && answeredMove(moved, replacingOccurrence(result));
      if (move) announceMove(move);
    },
    settled() {
      if (!ref || !held) return;
      holdMoving(ref, -1);
      announceMove();
    },
  };
}

/** Whether `eventId` is a local event the server has not confirmed yet. */
export function isCalendarEventCreating(eventId: string): boolean {
  return pendingCreates.has(eventId);
}

/** The server id of an event created under the local id `eventId`, once known. */
export function createdCalendarEventId(eventId: string): string | undefined {
  return landedCreates.get(eventId);
}

/**
 * The server's copy of the occurrence created under the local id `eventId`,
 * from the create's own answer, when it carried one.
 */
export function createdCalendarOccurrence(
  eventId: string
): CalendarOccurrenceItem | undefined {
  return landedReplies.get(eventId);
}

/** Calls `listener` when a create made here lands under its server id. */
export function onCalendarEventCreated(
  listener: (localId: string, serverId: string) => void
): () => void {
  landedListeners.add(listener);
  return () => landedListeners.delete(listener);
}

function forgetCreate(localId: string) {
  pendingCreates.delete(localId);
  unreadCreates.delete(localId);
}

/** Asks every tracked host where a confirmed create landed, once more. */
function readUnread(localId: string) {
  if (!unreadCreates.has(localId)) return;
  for (const read of createReaders) {
    fireAndForget(read(localId), 'calendar-create-settlement');
  }
}

function landCreate(
  localId: string,
  serverId: string | undefined,
  answered?: OccurrenceRecord
) {
  forgetCreate(localId);
  if (!serverId || serverId === localId) return;
  landedCreates.set(localId, serverId);
  if (answered) {
    landedReplies.set(localId, mapCalendarOccurrence(answered));
    const oldest = landedReplies.keys().next().value;
    if (landedReplies.size > LANDED_REPLY_LIMIT && oldest !== undefined)
      landedReplies.delete(oldest);
  }
  for (const listener of [...landedListeners]) listener(localId, serverId);
}

/**
 * The id a write must address. The durable queue replays a mutation's
 * variables unchanged, so a write addressed to an event that exists only
 * locally would reach the server with an id it never issued; one opened
 * before its create landed goes to the id the server gave it.
 */
function withServerEventId<T extends { eventId: string }>(args: T): T {
  if (pendingCreates.has(args.eventId)) {
    // The cache may have been too busy to tell where it landed.
    readUnread(args.eventId);
    throw new CalendarMutationError(
      'This event is still being created. Try again once it syncs.',
      'not_found',
      false
    );
  }
  const serverId = landedCreates.get(args.eventId);
  return serverId ? { ...args, eventId: serverId } : args;
}

/**
 * The server id the cache aliases a created event's local key to, once the
 * create has settled. The alias outlives the response content, so it holds
 * even when the response itself was retired.
 */
async function settledEventId(
  host: Pick<CacheHost, 'readRecordsByKeys'>,
  localId: string
): Promise<string | undefined> {
  const selected = await readRecordsByKeys(host, eventIdentitySelection, [
    eventKey(localId),
  ]);
  const identity = selected.records[0];
  if (
    !identity?.record.id ||
    identity.identity?.pending !== false ||
    identity.identity.mutationUuid !== localId
  )
    return undefined;
  return identity.record.id;
}

/**
 * Records where queued creates land once the queue settles them. A cache can
 * tell of a settlement while it cannot be read, as when it is paused, so a
 * create whose server id was not told stays pending until a host serves.
 */
export function trackCalendarCreateSettlements(
  host: Pick<
    CacheHost,
    'onMutationSettled' | 'onOwnerReady' | 'readRecordsByKeys'
  >
): () => void {
  let stopped = false;

  createReaders.add(landConfirmed);
  async function landConfirmed(localId: string): Promise<void> {
    let serverId: string | undefined;
    try {
      serverId = await settledEventId(host, localId);
    } catch {
      return;
    }
    if (stopped || !pendingCreates.has(localId)) return;
    // A create still waiting on its own answer lands from that answer.
    if (serverId || !answeringCreates.has(localId))
      landCreate(localId, serverId);
  }

  function landUnread(): void {
    for (const localId of unreadCreates) {
      fireAndForget(landConfirmed(localId), 'calendar-create-settlement');
    }
  }

  landUnread();
  const stopReady = host.onOwnerReady?.(landUnread);
  const stopSettled = host.onMutationSettled((settlement) => {
    const localId = settlement.mutationUuid;
    if (!localId || !pendingCreates.has(localId)) return;
    if (settlement.status !== 'committed') {
      forgetCreate(localId);
      return;
    }
    unreadCreates.add(localId);
    fireAndForget(landConfirmed(localId), 'calendar-create-settlement');
  });
  return () => {
    stopped = true;
    createReaders.delete(landConfirmed);
    stopReady?.();
    stopSettled();
  };
}

async function cachedEvent(
  host: CalendarMutationHost,
  eventId: string
): Promise<EventRecord | undefined> {
  const { records } = await readRecordsByKeys(host, eventSelection, [
    eventKey(eventId),
  ]);
  return records[0]?.record;
}

/** Every occurrence of one event the cache holds, from its range index. */
async function cachedOccurrences(
  host: CalendarMutationHost,
  eventId: string
): Promise<OccurrenceRecord[]> {
  const range = await host.calendarRange({
    ...ALL_TIME,
    eventKey: eventKey(eventId),
  });
  if (range.kind === 'unsupported' || range.occurrenceKeys.length === 0) {
    return [];
  }
  const records = await readOccurrenceRecords(host, range.occurrenceKeys);
  return records.map(({ record }) => record);
}

function graphqlError(result: OperationResult): CalendarMutationError {
  const error = result.error;
  const [first] = error?.graphQLErrors ?? [];
  const code = first?.extensions?.code;
  return new CalendarMutationError(
    first?.message ?? error?.message ?? 'Calendar mutation failed',
    typeof code === 'string' ? code : undefined,
    first?.extensions?.retryable === true
  );
}

/**
 * Resolves a mutation result. A committed answer is applied to the range
 * index, replacing the event's occurrence set, before it is returned; a
 * queued one is applied by the change log once it reaches the server.
 */
async function settle<TData, TVariables extends AnyVariables>(
  host: CalendarMutationHost,
  result: OperationResult<TData, TVariables>,
  payload: Payload | undefined
): Promise<CalendarMutationOutcome> {
  if (optimisticMutationDispositionOf(result)?.kind === 'queued') {
    return { kind: 'queued' };
  }
  if (result.error) throw graphqlError(result);
  if (!payload && optimisticMutationDispositionOf(result)?.kind === 'committed')
    return { kind: 'committed' };
  if (!payload) throw new Error('Calendar mutation returned no data');
  const generation = result.operation.context.cacheSessionGeneration;
  await host
    .calendarCommit(
      {
        ...(payload.event
          ? {
              replacedEvents: [
                {
                  eventKey: eventKey(payload.event.id),
                  occurrenceKeys: payload.occurrences
                    .filter((occurrence) => !occurrence.isCancelled)
                    .map(
                      (occurrence) => `${OCCURRENCE_TYPENAME}:${occurrence.id}`
                    ),
                },
              ],
            }
          : {}),
        ...(payload.deletedEventId
          ? { deletedEventKeys: [eventKey(payload.deletedEventId)] }
          : {}),
      },
      typeof generation === 'string' ? generation : UNKNOWN_CACHE_GENERATION
    )
    .catch((error) => {
      console.warn('Calendar mutation commit failed', error);
    });
  return { kind: 'committed', payload };
}

function payloadOf(
  event: Partial<EventRecord> | undefined,
  occurrences: Array<Partial<OccurrenceRecord>>
) {
  return {
    __typename: PAYLOAD_TYPENAME,
    ...(event ? { event } : {}),
    occurrences,
    deletedEventId: null,
  } as OptimisticResponse<Payload>;
}

/** Sets the viewer's RSVP through the durable queue. */
export async function executeGraphqlRsvp(
  host: CalendarMutationHost,
  rsvp: RsvpCalendarEventArgs,
  client: Client = getGraphqlSoupClient()
): Promise<CalendarMutationOutcome> {
  const args = withServerEventId(rsvp);
  const response = graphqlEnum<GraphqlCalendarAttendeeResponseStatus>(
    args.response
  );
  const oneOccurrence =
    args.scope === 'this_event' ||
    (args.scope === undefined && args.recurrenceId !== undefined);
  const [event, occurrences] = await Promise.all([
    cachedEvent(host, args.eventId),
    cachedOccurrences(host, args.eventId),
  ]);
  // An instance-scoped answer is recorded on that instance's own attendee
  // list. A series answer changes the series list and every instance that
  // carries its own, as the provider applies it.
  const patchedOccurrences = occurrences
    .filter((occurrence) =>
      oneOccurrence
        ? occurrence.occurrenceKey === args.occurrenceKey
        : occurrence.overrideAttendees !== null
    )
    .flatMap((occurrence) => {
      const attendees = withRsvp(
        occurrence.overrideAttendees ?? event?.attendees ?? [],
        args.respondingEmail,
        response
      );
      return attendees
        ? [
            {
              __typename: occurrence.__typename,
              id: occurrence.id,
              overrideAttendees: attendees,
            },
          ]
        : [];
    });
  const eventAttendees =
    event && !oneOccurrence
      ? withRsvp(event.attendees, args.respondingEmail, response)
      : undefined;
  const result = await executeOptimisticMutation(
    client,
    RespondToCalendarEventDocument,
    {
      input: {
        eventId: args.eventId,
        response,
        ...(args.scope
          ? { scope: graphqlEnum<GraphqlCalendarRsvpScope>(args.scope) }
          : {}),
        ...(args.recurrenceId ? { recurrenceId: args.recurrenceId } : {}),
        ...(args.respondingEmail
          ? { respondingEmail: args.respondingEmail }
          : {}),
      },
    },
    {
      respondToCalendarEvent: payloadOf(
        eventAttendees
          ? {
              __typename: EVENT_TYPENAME,
              id: args.eventId,
              attendees: eventAttendees,
            }
          : undefined,
        patchedOccurrences
      ),
    } as OptimisticResponse<RespondToCalendarEventMutation>,
    {
      uuid: uuidv5(
        JSON.stringify([
          args.eventId,
          oneOccurrence ? (args.occurrenceKey ?? null) : null,
          args.respondingEmail?.toLowerCase() ?? null,
        ]),
        RSVP_NAMESPACE
      ),
    }
  ).toPromise();
  return settle(host, result, result.data?.respondToCalendarEvent ?? undefined);
}

/**
 * Sets or clears the viewer's own color for a calendar. The cache shows the
 * color on the calendar's record at once, and the server's answer replaces
 * it, so every reader of the calendar list updates through the cache.
 */
export async function executeGraphqlSetCalendarColor(
  args: { calendarId: string; color: string | null },
  client: Client = getGraphqlSoupClient()
): Promise<CalendarMutationOutcome> {
  const result = await executeOptimisticMutation(
    client,
    SetCalendarColorDocument,
    { input: { calendarId: args.calendarId, color: args.color } },
    {
      setCalendarColor: {
        __typename: CALENDAR_TYPENAME,
        id: args.calendarId,
        customColor: args.color,
      },
    } as OptimisticResponse<SetCalendarColorMutation>,
    { uuid: uuidv5(args.calendarId, CALENDAR_COLOR_NAMESPACE) }
  ).toPromise();
  const disposition = optimisticMutationDispositionOf(result);
  if (disposition?.kind === 'queued') {
    return { kind: 'queued' };
  }
  if (result.error) throw graphqlError(result);
  // The queue can give up on a write that brought back no error.
  if (disposition?.kind === 'permanently-failed') throw disposition.error;
  return { kind: 'committed' };
}

/** Adds guests to the series or one occurrence through the durable queue. */
export async function executeGraphqlInviteGuests(
  host: CalendarMutationHost,
  invitation: InviteCalendarEventGuestsArgs,
  client: Client = getGraphqlSoupClient()
): Promise<CalendarMutationOutcome> {
  const args = withServerEventId(invitation);
  const oneOccurrence = args.scope === 'this_event';
  const [event, occurrences] = await Promise.all([
    cachedEvent(host, args.eventId),
    cachedOccurrences(host, args.eventId),
  ]);
  // Like an RSVP: guests added to one occurrence join that instance's own
  // attendee list; guests added to the series join the series list and every
  // instance that carries its own, as the provider applies it.
  const patchedOccurrences = occurrences
    .filter((occurrence) =>
      oneOccurrence
        ? occurrence.occurrenceKey === args.occurrenceKey
        : occurrence.overrideAttendees !== null
    )
    .map((occurrence) => ({
      __typename: occurrence.__typename,
      id: occurrence.id,
      overrideAttendees: withInvitedGuests(
        occurrence.overrideAttendees ?? event?.attendees ?? [],
        args.guests
      ),
    }));
  const result = await executeOptimisticMutation(
    client,
    InviteCalendarEventGuestsDocument,
    {
      input: {
        eventId: args.eventId,
        guests: args.guests.map((guest) => ({
          email: guest.email,
          optional: guest.optional ?? false,
        })),
        scope: graphqlEnum<InviteScope>(args.scope ?? 'all'),
        ...(args.calendarId ? { calendarId: args.calendarId } : {}),
        ...(args.recurrenceId ? { recurrenceId: args.recurrenceId } : {}),
      },
    },
    {
      inviteCalendarEventGuests: payloadOf(
        event && !oneOccurrence
          ? {
              __typename: EVENT_TYPENAME,
              id: args.eventId,
              attendees: withInvitedGuests(event.attendees, args.guests),
            }
          : undefined,
        patchedOccurrences
      ),
    } as OptimisticResponse<InviteCalendarEventGuestsMutation>,
    { uuid: uuidv4(), onEnqueued: args.onAccepted }
  ).toPromise();
  return settle(
    host,
    result,
    result.data?.inviteCalendarEventGuests ?? undefined
  );
}

/** Patches an event, the series or one occurrence, through the durable queue. */
export async function executeGraphqlUpdate(
  host: CalendarMutationHost,
  update: UpdateCalendarEventArgs,
  client: Client = getGraphqlSoupClient()
): Promise<CalendarMutationOutcome> {
  const args = withServerEventId(update);
  const { patch } = args;
  const oneOccurrence =
    args.scope === 'this_event' && args.occurrenceKey !== undefined;
  const [event, occurrences] = await Promise.all([
    cachedEvent(host, args.eventId),
    cachedOccurrences(host, args.eventId),
  ]);
  const optimisticEvent =
    event && !oneOccurrence
      ? patchedEvent(event, patch, args.calendarId)
      : undefined;
  const time = patch.time;
  const optimisticOccurrences = oneOccurrence
    ? occurrences
        .filter((occurrence) => occurrence.occurrenceKey === args.occurrenceKey)
        .map((occurrence) => patchedOccurrence(occurrence, patch))
    : time && event
      ? occurrences
          .filter((occurrence) => isStandalone(event, occurrence))
          .map((occurrence) => ({
            __typename: occurrence.__typename,
            id: occurrence.id,
            time: graphqlOccurrenceTimeRecord(time),
          }))
      : [];
  // A recurring series' instances are expanded by the provider, so a time
  // or rule change cannot be predicted until the server answers.
  const recurring =
    (event?.recurrenceLines.length ?? 0) > 0 ||
    (patch.recurrenceLines?.length ?? 0) > 0;
  const uncertain =
    !oneOccurrence &&
    recurring &&
    (patch.time != null || patch.recurrenceLines != null);
  const move = trackMove(movedOccurrence(event, occurrences, patch, recurring));
  const sent = executeOptimisticMutation(
    client,
    UpdateCalendarEventDocument,
    {
      input: {
        eventId: args.eventId,
        ...(args.calendarId ? { calendarId: args.calendarId } : {}),
        ...(args.scope
          ? { scope: graphqlEnum<GraphqlCalendarUpdateScope>(args.scope) }
          : {}),
        ...(args.recurrenceId ? { recurrenceId: args.recurrenceId } : {}),
        ...(patch.title != null ? { title: patch.title } : {}),
        ...(patch.description !== undefined
          ? { description: patch.description }
          : {}),
        ...(patch.location !== undefined ? { location: patch.location } : {}),
        ...(patch.time ? { time: graphqlTimeInput(patch.time) } : {}),
        ...(patch.attendees
          ? {
              attendees: patch.attendees.map((attendee) => ({
                email: attendee.email,
                isOptional: attendee.isOptional ?? false,
              })),
            }
          : {}),
        ...(patch.recurrenceLines != null
          ? { recurrenceLines: patch.recurrenceLines }
          : {}),
        ...(patch.visibility
          ? {
              visibility: graphqlEnum<GraphqlCalendarEventVisibility>(
                patch.visibility
              ),
            }
          : {}),
        ...(patch.transparency
          ? {
              transparency: graphqlEnum<GraphqlCalendarEventTransparency>(
                patch.transparency
              ),
            }
          : {}),
        ...(patch.reminders
          ? { reminders: graphqlReminders(patch.reminders) }
          : {}),
        ...(patch.guestPolicy ? { guestPolicy: patch.guestPolicy } : {}),
        ...(patch.conference
          ? {
              conference: graphqlEnum<GraphqlCalendarConferenceChange>(
                patch.conference
              ),
            }
          : {}),
        ...(patch.outOfOffice
          ? {
              outOfOffice: {
                ...(patch.outOfOffice.autoDeclineMode
                  ? {
                      autoDeclineMode:
                        graphqlEnum<GraphqlCalendarOutOfOfficeAutoDeclineMode>(
                          patch.outOfOffice.autoDeclineMode
                        ),
                    }
                  : {}),
                declineMessage: patch.outOfOffice.declineMessage ?? null,
              },
            }
          : {}),
      },
    },
    {
      updateCalendarEvent: payloadOf(optimisticEvent, optimisticOccurrences),
    } as OptimisticResponse<UpdateCalendarEventMutation>,
    {
      uuid: uuidv4(),
      onEnqueued: () => {
        move.enqueued();
        args.onAccepted?.();
      },
      ...(uncertain
        ? { uncertainCalendarEventKeys: [eventKey(args.eventId)] }
        : {}),
    }
  ).toPromise();
  try {
    const result = await sent;
    // Announced before the answer replaces the event's occurrences, so open
    // details know where to go before the moved occurrence leaves.
    move.answered(result);
    return await settle(
      host,
      result,
      result.data?.updateCalendarEvent ?? undefined
    );
  } finally {
    move.settled();
  }
}

/** Deletes an event, one occurrence, or an occurrence onward. */
export async function executeGraphqlDelete(
  host: CalendarMutationHost,
  deletion: DeleteCalendarEventArgs,
  client: Client = getGraphqlSoupClient()
): Promise<CalendarMutationOutcome> {
  const args = withServerEventId(deletion);
  const [event, occurrences] = await Promise.all([
    cachedEvent(host, args.eventId),
    cachedOccurrences(host, args.eventId),
  ]);
  const plan = deletionPlan(event, occurrences, args);
  const result = await executeOptimisticMutation(
    client,
    DeleteCalendarEventDocument,
    {
      input: {
        eventId: args.eventId,
        ...(args.calendarId ? { calendarId: args.calendarId } : {}),
        ...(args.scope
          ? { scope: graphqlEnum<GraphqlCalendarDeletionScope>(args.scope) }
          : {}),
        ...(args.recurrenceId ? { recurrenceId: args.recurrenceId } : {}),
      },
    },
    {
      deleteCalendarEvent: payloadOf(
        plan.event,
        plan.cancelled.map((occurrence) => ({
          __typename: occurrence.__typename,
          id: occurrence.id,
          isCancelled: true,
        }))
      ),
    } as OptimisticResponse<DeleteCalendarEventMutation>,
    { uuid: uuidv4() }
  ).toPromise();
  return settle(host, result, result.data?.deleteCalendarEvent ?? undefined);
}

/** What a new event's local copy takes from the calendar it lands on. */
interface TargetCalendar {
  id: string;
  linkId: string;
  emailAddress: string;
  guestPolicy: boolean;
}

/**
 * The calendar a new event lands on, as the server picks it. A calendar the
 * caller already holds needs no read: the cache answers the list only after
 * every read queued before it, which can take seconds.
 */
async function targetCalendar(
  client: Client,
  {
    calendarId,
    calendar,
  }: Pick<CreateCalendarEventArgs, 'calendarId' | 'calendar'>
): Promise<TargetCalendar | undefined> {
  if (calendar && calendar.id === calendarId) {
    return {
      id: calendar.id,
      linkId: calendar.emailLinkId,
      emailAddress: calendar.emailAddress,
      guestPolicy: calendar.capabilities.guestPolicy,
    };
  }
  const result = await client
    .query(CalendarsDocument, {}, { requestPolicy: 'cache-only' })
    .toPromise();
  const calendars = result.data?.user.calendars ?? [];
  const listed = calendarId
    ? calendars.find((candidate) => candidate.id === calendarId)
    : calendars.find(
        (candidate) => candidate.isPrimary && candidate.isWritable
      );
  return (
    listed && {
      id: listed.id,
      linkId: listed.linkId,
      emailAddress: listed.emailAddress,
      guestPolicy: listed.capabilities.guestPolicy,
    }
  );
}

/**
 * Creates an event through the durable queue. The event shows at once under
 * a client id that is also the request's idempotency key, so a replay after
 * a lost response cannot create it twice. `onAccepted` receives that local
 * event once the queue holds the create, before the server answers.
 * A confirmed create may omit `event` when response retirement leaves its
 * canonical identity temporarily unavailable; callers close and refresh.
 */
export async function executeGraphqlCreate(
  args: CreateCalendarEventArgs,
  client: Client = getGraphqlSoupClient(),
  host?: Pick<CacheHost, 'readRecordsByKeys'>
): Promise<{ outcome: CalendarMutationOutcome; event?: CalendarEvent }> {
  const clientId = args.idempotencyKey ?? uuidv4();
  answeringCreates.add(clientId);
  try {
    return await createThroughQueue(
      { ...args, idempotencyKey: clientId },
      client,
      host
    );
  } finally {
    answeringCreates.delete(clientId);
    // It settled while its call was out, and the call answered nothing more.
    readUnread(clientId);
  }
}

async function createThroughQueue(
  { onAccepted, calendar: knownCalendar, ...args }: CreateCalendarEventArgs,
  client: Client,
  host: Pick<CacheHost, 'readRecordsByKeys'> | undefined
): Promise<{ outcome: CalendarMutationOutcome; event?: CalendarEvent }> {
  const clientId = args.idempotencyKey ?? uuidv4();
  const calendar = await targetCalendar(client, {
    calendarId: args.calendarId ?? undefined,
    calendar: knownCalendar,
  });
  const now = new Date().toISOString();
  const time = graphqlTimeRecord(args.time);
  const reminders = args.reminders
    ? graphqlReminders(args.reminders)
    : { useDefault: true, overrides: [] };
  const visibility = graphqlEnum<EventRecord['visibility']>(
    args.visibility ?? 'default'
  );
  const transparency = graphqlEnum<EventRecord['transparency']>(
    args.transparency ?? 'opaque'
  );
  const eventType: EventRecord['eventType'] = args.outOfOffice
    ? 'OUT_OF_OFFICE'
    : 'DEFAULT';
  const calendarId = args.calendarId ?? calendar?.id ?? null;
  const linkId = args.emailLinkId ?? calendar?.linkId ?? '';
  const event: EventRecord = {
    __typename: EVENT_TYPENAME,
    id: clientId,
    ownerId: '',
    linkId,
    icalUid: clientId,
    calendarId,
    sources: calendarId
      ? [
          {
            calendarId,
            title: args.title,
            description: args.description ?? null,
            location: args.location ?? null,
            eventType,
            visibility,
            transparency,
            isReadOnly: false,
            reminders,
            creatorEmail: calendar?.emailAddress ?? null,
            creatorName: null,
          },
        ]
      : [],
    title: args.title,
    description: args.description ?? null,
    location: args.location ?? null,
    status: 'CONFIRMED',
    visibility,
    transparency,
    eventType,
    time,
    recurrenceLines: args.recurrenceLines ?? [],
    organizerEmail: calendar?.emailAddress ?? null,
    organizerName: null,
    creatorEmail: calendar?.emailAddress ?? null,
    creatorName: null,
    conferenceUrl: null,
    conferenceProvider: null,
    sequence: 0,
    isReadOnly: false,
    attendees: (args.attendees ?? []).map((attendee) => ({
      email: attendee.email,
      displayName: null,
      responseStatus: 'NEEDS_ACTION',
      isOrganizer: false,
      isOptional: attendee.isOptional ?? false,
      isSelf: false,
      comment: null,
    })),
    reminders,
    guestPolicy: args.guestPolicy ?? {
      canModify: false,
      canInviteOthers: true,
      canSeeOtherGuests: true,
    },
    isSnapshot: false,
    // The viewer organizes what they create; the server adds their own
    // attendee row, and with it the RSVP, when the event lands.
    viewerCan: {
      editDetails: true,
      inviteGuests: true,
      removeGuests: true,
      setGuestPolicy: calendar?.guestPolicy ?? false,
      rsvp: false,
      organize: true,
    },
    createdAt: now,
    updatedAt: now,
  };
  const occurrenceKey = occurrenceKeyOf(args.time);
  const occurrence: OccurrenceRecord = {
    __typename: OCCURRENCE_TYPENAME,
    id: `${clientId}:${occurrenceKey}`,
    eventId: clientId,
    linkId,
    occurrenceKey,
    recurrenceId: null,
    isCancelled: false,
    time: graphqlOccurrenceTimeRecord(args.time),
    overrideTitle: null,
    overrideDescription: null,
    overrideLocation: null,
    overrideStatus: null,
    overrideAttendees: null,
    event,
  };
  const result = await executeOptimisticMutation(
    client,
    CreateCalendarEventDocument,
    {
      input: {
        idempotencyKey: clientId,
        title: args.title,
        time: graphqlTimeInput(args.time),
        ...(args.calendarId ? { calendarId: args.calendarId } : {}),
        ...(args.emailLinkId ? { emailLinkId: args.emailLinkId } : {}),
        ...(args.description != null ? { description: args.description } : {}),
        ...(args.location != null ? { location: args.location } : {}),
        ...(args.attendees?.length
          ? {
              attendees: args.attendees.map((attendee) => ({
                email: attendee.email,
                isOptional: attendee.isOptional ?? false,
              })),
            }
          : {}),
        ...(args.recurrenceLines?.length
          ? { recurrenceLines: args.recurrenceLines }
          : {}),
        ...(args.visibility ? { visibility } : {}),
        ...(args.transparency ? { transparency } : {}),
        ...(args.reminders ? { reminders } : {}),
        ...(args.conference
          ? {
              conference: graphqlEnum<GraphqlCalendarConferenceChange>(
                args.conference
              ),
            }
          : {}),
        ...(args.macroCall ? { macroCall: true } : {}),
        ...(args.guestPolicy ? { guestPolicy: args.guestPolicy } : {}),
        ...(args.outOfOffice
          ? {
              outOfOffice: {
                ...(args.outOfOffice.autoDeclineMode
                  ? {
                      autoDeclineMode:
                        graphqlEnum<GraphqlCalendarOutOfOfficeAutoDeclineMode>(
                          args.outOfOffice.autoDeclineMode
                        ),
                    }
                  : {}),
                declineMessage: args.outOfOffice.declineMessage ?? null,
              },
            }
          : {}),
      },
    },
    {
      createCalendarEvent: {
        __typename: PAYLOAD_TYPENAME,
        event,
        occurrences: [occurrence],
        deletedEventId: null,
      },
    } as OptimisticResponse<CreateCalendarEventMutation>,
    {
      uuid: clientId,
      // Registered as the queue installs the create, so a settlement that
      // arrives before this call returns always clears it.
      onEnqueued: () => {
        pendingCreates.add(clientId);
        onAccepted?.(mapCalendarEvent(event));
      },
      identityBindings: [
        {
          localKey: eventKey(clientId),
          responsePath: ['createCalendarEvent', 'event'],
          referenceFields: [`${OCCURRENCE_TYPENAME}.eventId`],
        },
      ],
      ...(event.recurrenceLines.length > 0
        ? { uncertainCalendarEventKeys: [eventKey(clientId)] }
        : {}),
    }
  ).toPromise();
  let outcome: CalendarMutationOutcome;
  try {
    outcome = await settleCreate(result);
  } catch (error) {
    forgetCreate(clientId);
    throw error;
  }
  if (outcome.kind === 'queued') {
    return { outcome, event: mapCalendarEvent(event) };
  }
  if (!outcome.payload?.event) {
    // Settlement preserves the local-to-server alias even when its response
    // content is retired. Navigation and later edits must use that server ID.
    const cache = host ?? getGraphqlSoupCacheHost();
    // It lands once a host that serves tells its server id.
    const unread = () => {
      if (pendingCreates.has(clientId)) unreadCreates.add(clientId);
      return { outcome };
    };
    // A paused cache has no host to ask.
    if (!cache) return unread();
    let serverId: string | undefined;
    try {
      serverId = await settledEventId(cache, clientId);
    } catch {
      return unread();
    }
    landCreate(clientId, serverId);
    // Creation succeeded. The caller closes and refreshes without offering
    // a duplicate create or navigating to an unconfirmed local identifier.
    if (!serverId) return { outcome };
    return { outcome, event: mapCalendarEvent({ ...event, id: serverId }) };
  }
  const answered = outcome.payload.occurrences;
  landCreate(
    clientId,
    outcome.payload.event.id,
    answered.find((item) => item.occurrenceKey === occurrenceKey) ??
      (answered.length === 1 ? answered[0] : undefined)
  );
  return {
    outcome,
    event: mapCalendarEvent(outcome.payload.event),
  };

  async function settleCreate(
    created: OperationResult<CreateCalendarEventMutation>
  ): Promise<CalendarMutationOutcome> {
    if (optimisticMutationDispositionOf(created)?.kind === 'queued') {
      return { kind: 'queued' };
    }
    if (created.error) throw graphqlError(created);
    const payload = created.data?.createCalendarEvent;
    if (
      !payload &&
      optimisticMutationDispositionOf(created)?.kind === 'committed'
    )
      return { kind: 'committed' };
    if (!payload?.event) throw new Error('Calendar create returned no event');
    return { kind: 'committed', payload };
  }
}

/** The committed event, mapped to the REST shape callers consume. */
export function committedEvent(
  outcome: CalendarMutationOutcome
): CalendarEvent | undefined {
  return outcome.kind === 'committed' && outcome.payload?.event
    ? mapCalendarEvent(outcome.payload.event)
    : undefined;
}
