import type { OptimisticResponse } from '@graphql-cache/exchange/optimistic';
import {
  type CacheHost,
  executeOptimisticMutation,
  optimisticMutationDispositionOf,
  readRecordsByKeys,
  selectRecords,
} from '@graphql-cache/index';
import type { CalendarEvent } from '@service-calendar/generated/schemas/calendarEvent';
import type { CreateCalendarEventRequest } from '@service-calendar/generated/schemas/createCalendarEventRequest';
import {
  type CalendarEventFieldsFragment,
  CalendarEventFieldsFragmentDoc,
  type CalendarMutationPayloadFieldsFragment,
  type CalendarOccurrenceItemFieldsFragment,
  CalendarOccurrenceItemFieldsFragmentDoc,
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
  RespondToCalendarEventDocument,
  type RespondToCalendarEventMutation,
  UpdateCalendarEventDocument,
  type UpdateCalendarEventMutation,
} from '@service-storage/graphql/generated/graphql';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import type { AnyVariables, Client, OperationResult } from '@urql/core';
import { v4 as uuidv4, v5 as uuidv5 } from 'uuid';
import type {
  DeleteCalendarEventArgs,
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
  withRsvp,
} from './optimistic';
import { epochDay } from './range';

export type CalendarMutationHost = Pick<
  CacheHost,
  'calendarRange' | 'calendarCommit' | 'readRecordsByKeys'
>;

type EventRecord = CalendarEventFieldsFragment;
type OccurrenceRecord = CalendarOccurrenceItemFieldsFragment;
type Payload = CalendarMutationPayloadFieldsFragment;

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
  | { kind: 'committed'; payload: Payload }
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
const occurrenceSelection = selectRecords(
  CalendarOccurrenceItemFieldsFragmentDoc
);

/** Events created while offline, until their create settles. */
const pendingCreates = new Set<string>();

/**
 * The durable queue replays a mutation's variables unchanged, so a write
 * addressed to an event that exists only locally would reach the server with
 * an id it never issued.
 */
function assertCreated(eventId: string) {
  if (pendingCreates.has(eventId)) {
    throw new CalendarMutationError(
      'This event is still being created. Try again once it syncs.',
      'not_found',
      false
    );
  }
}

/** Forgets queued creates once the queue settles them. */
export function trackCalendarCreateSettlements(
  host: Pick<CacheHost, 'onMutationSettled'>
): () => void {
  return host.onMutationSettled((settlement) => {
    if (settlement.mutationUuid) pendingCreates.delete(settlement.mutationUuid);
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
  const { records } = await readRecordsByKeys(
    host,
    occurrenceSelection,
    range.occurrenceKeys
  );
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
  if (!payload) throw new Error('Calendar mutation returned no data');
  await host
    .calendarCommit({
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
    })
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
  args: RsvpCalendarEventArgs,
  client: Client = getGraphqlSoupClient()
): Promise<CalendarMutationOutcome> {
  assertCreated(args.eventId);
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

/** Patches an event, the series or one occurrence, through the durable queue. */
export async function executeGraphqlUpdate(
  host: CalendarMutationHost,
  args: UpdateCalendarEventArgs,
  client: Client = getGraphqlSoupClient()
): Promise<CalendarMutationOutcome> {
  assertCreated(args.eventId);
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
  args: DeleteCalendarEventArgs,
  client: Client = getGraphqlSoupClient()
): Promise<CalendarMutationOutcome> {
  assertCreated(args.eventId);
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
 * a lost response cannot create it twice.
 */
export async function executeGraphqlCreate(
  args: CreateCalendarEventRequest,
  client: Client = getGraphqlSoupClient()
): Promise<{ outcome: CalendarMutationOutcome; event: CalendarEvent }> {
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
  const outcome = await settleCreate(result);
  if (outcome.kind === 'queued') {
    pendingCreates.add(clientId);
    return { outcome, event: mapCalendarEvent(event) };
  }
  return {
    outcome,
    event: mapCalendarEvent(outcome.payload.event ?? event),
  };

  async function settleCreate(
    created: OperationResult<CreateCalendarEventMutation>
  ): Promise<CalendarMutationOutcome> {
    if (optimisticMutationDispositionOf(created)?.kind === 'queued') {
      return { kind: 'queued' };
    }
    if (created.error) throw graphqlError(created);
    const payload = created.data?.createCalendarEvent;
    if (!payload?.event) throw new Error('Calendar create returned no event');
    return { kind: 'committed', payload };
  }
}

/** The committed event, mapped to the REST shape callers consume. */
export function committedEvent(
  outcome: CalendarMutationOutcome
): CalendarEvent | undefined {
  return outcome.kind === 'committed' && outcome.payload.event
    ? mapCalendarEvent(outcome.payload.event)
    : undefined;
}
