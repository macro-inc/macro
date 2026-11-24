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
import { mapCalendarEvent } from './map';
import {
  deletionPlan,
  graphqlEnum,
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
/** Namespaces RSVP coalescing keys; a newer answer replaces a queued one. */
const RSVP_NAMESPACE = '1b671a64-40d5-491e-99b0-da01ff1f3341';
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
const landedListeners = new Set<(localId: string, serverId: string) => void>();

/** Whether `eventId` is a local event the server has not confirmed yet. */
export function isCalendarEventCreating(eventId: string): boolean {
  return pendingCreates.has(eventId);
}

/** The server id of an event created under the local id `eventId`, once known. */
export function createdCalendarEventId(eventId: string): string | undefined {
  return landedCreates.get(eventId);
}

/** Calls `listener` when a create made here lands under its server id. */
export function onCalendarEventCreated(
  listener: (localId: string, serverId: string) => void
): () => void {
  landedListeners.add(listener);
  return () => landedListeners.delete(listener);
}

function landCreate(localId: string, serverId: string | undefined) {
  pendingCreates.delete(localId);
  if (!serverId || serverId === localId) return;
  landedCreates.set(localId, serverId);
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
  ]).catch(() => undefined);
  const identity = selected?.records[0];
  if (
    !identity?.record.id ||
    identity.identity?.pending !== false ||
    identity.identity.mutationUuid !== localId
  )
    return undefined;
  return identity.record.id;
}

/** Records where queued creates land once the queue settles them. */
export function trackCalendarCreateSettlements(
  host: Pick<CacheHost, 'onMutationSettled' | 'readRecordsByKeys'>
): () => void {
  return host.onMutationSettled((settlement) => {
    const localId = settlement.mutationUuid;
    if (!localId || !pendingCreates.has(localId)) return;
    if (settlement.status !== 'committed') {
      pendingCreates.delete(localId);
      return;
    }
    fireAndForget(
      (async () => {
        const serverId = await settledEventId(host, localId);
        // A create still waiting on its own answer lands from that answer.
        if (serverId || !answeringCreates.has(localId))
          landCreate(localId, serverId);
      })(),
      'calendar-create-settlement'
    );
  });
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
            time: graphqlTimeRecord(time),
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
  const result = await executeOptimisticMutation(
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
      onEnqueued: args.onAccepted,
      ...(uncertain
        ? { uncertainCalendarEventKeys: [eventKey(args.eventId)] }
        : {}),
    }
  ).toPromise();
  return settle(host, result, result.data?.updateCalendarEvent ?? undefined);
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

/** The calendar a new event lands on, as the server picks it. */
async function targetCalendar(client: Client, calendarId: string | undefined) {
  const result = await client
    .query(CalendarsDocument, {}, { requestPolicy: 'cache-only' })
    .toPromise();
  const calendars = result.data?.user.calendars ?? [];
  return calendarId
    ? calendars.find((calendar) => calendar.id === calendarId)
    : calendars.find((calendar) => calendar.isPrimary && calendar.isWritable);
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
  }
}

async function createThroughQueue(
  { onAccepted, ...args }: CreateCalendarEventArgs,
  client: Client,
  host: Pick<CacheHost, 'readRecordsByKeys'> | undefined
): Promise<{ outcome: CalendarMutationOutcome; event?: CalendarEvent }> {
  const clientId = args.idempotencyKey ?? uuidv4();
  const calendar = await targetCalendar(client, args.calendarId ?? undefined);
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
      setGuestPolicy: calendar?.capabilities.guestPolicy ?? false,
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
    time,
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
    pendingCreates.delete(clientId);
    throw error;
  }
  if (outcome.kind === 'queued') {
    return { outcome, event: mapCalendarEvent(event) };
  }
  if (!outcome.payload?.event) {
    // Settlement preserves the local-to-server alias even when its response
    // content is retired. Navigation and later edits must use that server ID.
    const cache = host ?? getGraphqlSoupCacheHost();
    const serverId = cache ? await settledEventId(cache, clientId) : undefined;
    landCreate(clientId, serverId);
    // Creation succeeded. The caller closes and refreshes without offering
    // a duplicate create or navigating to an unconfirmed local identifier.
    if (!serverId) return { outcome };
    return { outcome, event: mapCalendarEvent({ ...event, id: serverId }) };
  }
  landCreate(clientId, outcome.payload.event.id);
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
