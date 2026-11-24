// Real production worker/WASM/OPFS and mutation queue with a scripted server:
// a calendar create is saved locally before the server answers, lands under
// the server's id, or leaves the calendar when the server refuses it.
import { createClient, fetchExchange } from '@urql/core';
import {
  CalendarMutationError,
  createdCalendarEventId,
  executeGraphqlCreate,
  isCalendarEventCreating,
  trackCalendarCreateSettlements,
} from '../../../queries/calendar/graphql/mutations';
import {
  graphqlEvent,
  graphqlOccurrence,
} from '../../../queries/calendar/graphql/tests/fixtures';
import { normalizedCacheExchange } from '../../exchange/normalized-cache-exchange';
import { createWorkerCacheHost } from '../../host/worker-host';
import { cacheSessionGeneration } from '../../session-generation';

type Answer = 'create' | 'refuse';

declare global {
  interface Window {
    calendarCreate: { run: (answer: Answer) => Promise<unknown> };
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

let release: (() => void) | undefined;
let answer: Answer = 'create';
let serverRequests = 0;

function respond(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** Answers the create once the test releases it, as the provider would. */
async function server(_input: RequestInfo | URL, init?: RequestInit) {
  serverRequests += 1;
  const request = JSON.parse(String(init?.body ?? '{}'));
  await new Promise<void>((resolve) => {
    release = resolve;
  });
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

const client = createClient({
  url: 'http://calendar-create.test/graphql',
  fetch: server,
  exchanges: [normalizedCacheExchange(host), fetchExchange],
});

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

async function run(next: Answer) {
  await coverTheDay();
  answer = next;
  release = undefined;
  let acceptedId: string | undefined;
  let settled = false;
  const created = (async () => {
    try {
      return {
        value: await executeGraphqlCreate(
          {
            title: `Offsite ${next}`,
            // The engine draws no occurrence without its inbox link.
            calendarId: 'calendar-1',
            emailLinkId: 'link-1',
            time: {
              kind: 'timed',
              startsAt: TIME.startsAt,
              endsAt: TIME.endsAt,
              timeZone: 'UTC',
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
  await until(async () => release !== undefined, 'the request');
  const beforeAnswer = {
    settled,
    creating: isCalendarEventCreating(localId),
  };

  release?.();
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
  await until(async () => {
    const keys = await eventsOnTheDay();
    return !shows(keys, localId) && shows(keys, serverId ?? '');
  }, 'the server event to replace the local one');
  return {
    beforeAnswer,
    landedUnder: createdCalendarEventId(localId) === serverId,
    creating: isCalendarEventCreating(localId),
  };
}

// The app stamps its writes with the owner's generation; the engine refuses
// optimistic content stamped with any other.
cacheSessionGeneration.initialize((await host.authority!.current()).generation);
window.calendarCreate = { run };
result.dataset.status = 'ready';
