// Real production worker/WASM/OPFS and mutation queue with a scripted server:
// a calendar create is saved locally before the server answers, lands under
// the server's id, or leaves the calendar when the server refuses it; a
// created event moved an hour lands on the occurrence the server keys anew.
import { CalendarOccurrenceItemFieldsFragmentDoc } from '@service-storage/graphql/generated/graphql';
import {
  createClient,
  fetchExchange,
  getOperationName,
  mapExchange,
} from '@urql/core';
import {
  CalendarMutationError,
  createdCalendarEventId,
  createdCalendarOccurrence,
  executeGraphqlCreate,
  executeGraphqlUpdate,
  isCalendarEventCreating,
  isCalendarOccurrenceMoving,
  onCalendarOccurrenceMoved,
  trackCalendarCreateSettlements,
} from '../../../queries/calendar/graphql/mutations';
import {
  graphqlEvent,
  graphqlOccurrence,
} from '../../../queries/calendar/graphql/tests/fixtures';
import { normalizedCacheExchange } from '../../exchange/normalized-cache-exchange';
import { createWorkerCacheHost } from '../../host/worker-host';
import { readRecordsByKeys, selectRecords } from '../../index';
import { cacheSessionGeneration } from '../../session-generation';

type Answer = 'create' | 'refuse';
interface RunOptions {
  /** Hand the create the calendar, as the event dialog does. */
  knownCalendar?: boolean;
}

declare global {
  interface Window {
    calendarCreate: {
      run: (answer: Answer, options?: RunOptions) => Promise<unknown>;
      move: () => Promise<unknown>;
    };
  }
}

const result = document.querySelector<HTMLPreElement>('#result')!;
const host = createWorkerCacheHost({
  scope: `calendar-create-${crypto.randomUUID()}`,
  requestTimeoutMs: 20_000,
  rolloutCohort: 'treatment',
});
trackCalendarCreateSettlements(host);

const DAY_START = Date.parse('2026-11-28T00:00:00Z');
const DAY_END = Date.parse('2026-11-29T00:00:00Z');
const TIME = {
  __typename: 'GraphqlTimedEventTime' as const,
  startsAt: '2026-11-28T15:00:00+00:00',
  endsAt: '2026-11-28T16:00:00+00:00',
  timeZone: 'UTC',
};
/** An hour later, where a drag drops the event. */
const MOVED_TIME = {
  ...TIME,
  startsAt: '2026-11-28T16:00:00+00:00',
  endsAt: '2026-11-28T17:00:00+00:00',
};

/** Releases the held server answer; set once the request arrives. */
let release: (() => void) | undefined;
const requestArrived = () => release !== undefined;
const answerRequest = () => release?.();
let answer: Answer | 'move' = 'create';
let serverRequests = 0;

function respond(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * The moved event as the provider answers: same id, its occurrence keyed by
 * its new start.
 */
function movedAnswer(eventId: string) {
  const event = graphqlEvent({
    id: eventId,
    title: 'Offsite move',
    eventType: 'DEFAULT',
    recurrenceLines: [],
    time: MOVED_TIME,
  });
  return respond({
    data: {
      updateCalendarEvent: {
        __typename: 'GraphqlCalendarMutationPayload',
        event,
        occurrences: [
          graphqlOccurrence({
            id: `${eventId}:${MOVED_TIME.startsAt}`,
            eventId,
            occurrenceKey: MOVED_TIME.startsAt,
            time: MOVED_TIME,
            event,
          }),
        ],
        deletedEventId: null,
      },
    },
  });
}

/** Answers the create once the test releases it, as the provider would. */
async function server(_input: RequestInfo | URL, init?: RequestInit) {
  serverRequests += 1;
  const request = JSON.parse(String(init?.body ?? '{}'));
  // The move's event is created first, and answered at once.
  if (answer === 'move' && request.operationName !== 'UpdateCalendarEvent')
    return createdAnswer(request);
  await new Promise<void>((resolve) => {
    release = resolve;
  });
  if (request.operationName === 'UpdateCalendarEvent')
    return movedAnswer(request.variables.input.eventId);
  if (answer === 'refuse')
    return respond({
      data: null,
      errors: [
        {
          message: 'This calendar is read-only.',
          extensions: { code: 'read_only', retryable: false },
        },
      ],
    });
  return createdAnswer(request);
}

function createdAnswer(request: { variables: { input: { title: string } } }) {
  const serverId = `server-${serverRequests}`;
  const event = graphqlEvent({
    id: serverId,
    title: request.variables.input.title,
    eventType: 'DEFAULT',
    recurrenceLines: [],
    time: TIME,
  });
  return respond({
    data: {
      createCalendarEvent: {
        __typename: 'GraphqlCalendarMutationPayload',
        event,
        occurrences: [
          graphqlOccurrence({
            id: `${serverId}:${TIME.startsAt}`,
            eventId: serverId,
            occurrenceKey: TIME.startsAt,
            time: TIME,
            event,
          }),
        ],
        deletedEventId: null,
      },
    },
  });
}

/** Every query the create sends through the client, by operation name. */
const queries: string[] = [];
const client = createClient({
  url: 'http://calendar-create.test/graphql',
  fetch: server,
  exchanges: [
    mapExchange({
      onOperation(operation) {
        if (operation.kind === 'query')
          queries.push(getOperationName(operation.query) ?? 'unnamed');
      },
    }),
    normalizedCacheExchange(host),
    fetchExchange,
  ],
});
const occurrenceSelection = selectRecords(
  CalendarOccurrenceItemFieldsFragmentDoc
);

/** The time zone of an occurrence the calendar holds. */
async function occurrenceTimeZone(key: string) {
  const { records } = await readRecordsByKeys(host, occurrenceSelection, [key]);
  const time = records[0]?.record.time;
  return time?.__typename === 'GraphqlTimedEventTime'
    ? time.timeZone
    : undefined;
}

/** The events the calendar shows on the test's day, by event id. */
async function eventsOnTheDay(): Promise<string[]> {
  const range = await host.calendarRange({
    startMs: DAY_START,
    endMs: DAY_END,
    startDay: 0,
    endDay: 0,
  });
  if (range.kind !== 'range') throw new Error('Calendar cache is unavailable');
  return range.occurrenceKeys;
}

async function until(check: () => Promise<boolean>, what: string) {
  const deadline = Date.now() + 20_000;
  while (!(await check())) {
    if (Date.now() > deadline)
      throw new Error(
        `Timed out waiting for ${what}; the day shows ${JSON.stringify(await eventsOnTheDay())}`
      );
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** The calendar has read the test's day, so the range answers for it. */
async function coverTheDay() {
  await host.calendarCommit(
    {
      coverage: [{ kind: 'timed', start: DAY_START, end: DAY_END }],
      freshness: 'fresh',
    },
    (await host.authority!.current()).generation
  );
}

async function run(next: Answer, options: RunOptions = {}) {
  await coverTheDay();
  answer = next;
  release = undefined;
  queries.length = 0;
  let acceptedId: string | undefined;
  let settled = false;
  const created = (async () => {
    try {
      return {
        value: await executeGraphqlCreate(
          {
            title: `Offsite ${next}`,
            calendarId: 'calendar-1',
            // The engine draws no occurrence without its inbox link, which
            // the dialog's calendar carries.
            ...(options.knownCalendar
              ? {
                  calendar: {
                    id: 'calendar-1',
                    emailLinkId: 'link-1',
                    emailAddress: 'me@example.com',
                    capabilities: {
                      autoDecline: true,
                      customRecurrence: true,
                      emailReminders: true,
                      removeConference: true,
                      resetRsvp: true,
                      guestPolicy: true,
                    },
                  },
                }
              : { emailLinkId: 'link-1' }),
            // The editor names the browser's own time zone.
            time: {
              kind: 'timed',
              startsAt: TIME.startsAt,
              endsAt: TIME.endsAt,
              timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            },
            onAccepted: (event) => {
              acceptedId = event.id;
            },
          },
          client,
          host
        ),
      };
    } catch (error) {
      return { error };
    } finally {
      settled = true;
    }
  })();

  await until(async () => acceptedId !== undefined, 'the local save');
  const localId = acceptedId ?? '';
  const shows = (keys: string[], eventId: string) =>
    keys.some((key) => key.startsWith(`GraphqlCalendarOccurrence:${eventId}:`));
  await until(
    async () => shows(await eventsOnTheDay(), localId),
    'the local event on the calendar'
  );
  await until(async () => requestArrived(), 'the request');
  const localKey = (await eventsOnTheDay()).find((key) =>
    key.startsWith(`GraphqlCalendarOccurrence:${localId}:`)
  );
  const beforeAnswer = {
    settled,
    creating: isCalendarEventCreating(localId),
    calendarListReads: queries.filter((name) => name === 'Calendars').length,
    localTimeZone: localKey ? await occurrenceTimeZone(localKey) : 'none',
  };

  answerRequest();
  const outcome = await created;
  if ('error' in outcome) {
    await until(
      async () => !shows(await eventsOnTheDay(), localId),
      'the refused event to leave'
    );
    return {
      beforeAnswer,
      refused:
        outcome.error instanceof CalendarMutationError
          ? outcome.error.code
          : String(outcome.error),
      creating: isCalendarEventCreating(localId),
    };
  }
  const serverId = outcome.value.event?.id;
  // The details move to the server's copy from the answer, before the
  // calendar's own reads catch up with it.
  const answered = createdCalendarOccurrence(localId)?.occurrence.eventId;
  await until(async () => {
    const keys = await eventsOnTheDay();
    return !shows(keys, localId) && shows(keys, serverId ?? '');
  }, 'the server event to replace the local one');
  return {
    beforeAnswer,
    landedUnder: createdCalendarEventId(localId) === serverId,
    answeredWithServerCopy: answered !== undefined && answered === serverId,
    creating: isCalendarEventCreating(localId),
  };
}

/**
 * Creates an event, then moves it an hour as a grid drag does, holding the
 * server's answer to the move.
 */
async function move() {
  await coverTheDay();
  answer = 'move';
  const created = await executeGraphqlCreate(
    {
      title: 'Offsite move',
      calendarId: 'calendar-1',
      emailLinkId: 'link-1',
      time: { kind: 'timed', startsAt: TIME.startsAt, endsAt: TIME.endsAt },
    },
    client,
    host
  );
  const eventId = created.event?.id ?? '';
  const occurrenceAt = (start: string) =>
    `GraphqlCalendarOccurrence:${eventId}:${start}`;
  await until(
    async () => (await eventsOnTheDay()).includes(occurrenceAt(TIME.startsAt)),
    'the created event on the calendar'
  );

  release = undefined;
  const announced: string[] = [];
  const stopListening = onCalendarOccurrenceMoved((announcedMove) => {
    if (announcedMove)
      announced.push(
        `${announcedMove.from.occurrenceKey} -> ${announcedMove.to.occurrenceKey}`
      );
  });
  const moved = executeGraphqlUpdate(
    host,
    {
      eventId,
      calendarId: 'calendar-1',
      patch: {
        time: {
          kind: 'timed',
          startsAt: MOVED_TIME.startsAt,
          endsAt: MOVED_TIME.endsAt,
        },
      },
    },
    client
  );
  await until(async () => requestArrived(), 'the move');
  // The local move keeps the occurrence's id; only its time changes.
  const beforeAnswer = {
    moving: isCalendarOccurrenceMoving(eventId, TIME.startsAt),
    shown: (await eventsOnTheDay()).filter((key) =>
      key.startsWith(`GraphqlCalendarOccurrence:${eventId}:`)
    ),
  };

  answerRequest();
  await moved;
  await until(async () => {
    const keys = await eventsOnTheDay();
    return (
      keys.includes(occurrenceAt(MOVED_TIME.startsAt)) &&
      !keys.includes(occurrenceAt(TIME.startsAt))
    );
  }, 'the saved occurrence to replace the moved one');
  stopListening();
  return {
    beforeAnswer: {
      ...beforeAnswer,
      shown: beforeAnswer.shown.map((key) =>
        key === occurrenceAt(TIME.startsAt) ? 'moved occurrence' : key
      ),
    },
    // Open details follow the moved occurrence to the one the answer keyed.
    announced,
    moving: isCalendarOccurrenceMoving(eventId, TIME.startsAt),
  };
}

// The app stamps its writes with the owner's generation; the engine refuses
// optimistic content stamped with any other.
cacheSessionGeneration.initialize((await host.authority!.current()).generation);
window.calendarCreate = { run, move };
result.dataset.status = 'ready';
