// Real production worker/WASM/OPFS with synthetic calendar records only.
import { createWorkerCacheHost } from '../../host/worker-host';

const result = document.querySelector<HTMLPreElement>('#result')!;
const host = createWorkerCacheHost({
  scope: `calendar-points-${crypto.randomUUID()}`,
});
const instant = '2026-10-08T12:00:00Z';
const pointMs = Date.parse(instant);
const occurrenceKey = 'GraphqlCalendarOccurrence:point';
const query = `query CalendarPoints($input: CalendarRangeInput!) {
  user { id calendarOccurrences(input: $input) { nodes {
    __typename id eventId linkId isCancelled
    time { __typename ... on GraphqlTimedEventTime { startsAt endsAt timeZone } }
  } } }
}`;
const variables = {
  input: { start: '2026-10-08T00:00:00Z', end: '2026-10-09T00:00:00Z' },
};

async function write(endsAt: string) {
  await host.writeQuery({
    query,
    variables,
    data: {
      user: {
        id: 'fixture-viewer',
        calendarOccurrences: {
          nodes: [
            {
              __typename: 'GraphqlCalendarOccurrence',
              id: 'point',
              eventId: 'point-event',
              linkId: 'fixture-link',
              isCancelled: false,
              time: {
                __typename: 'GraphqlTimedEventTime',
                startsAt: instant,
                endsAt,
                timeZone: 'UTC',
              },
            },
          ],
        },
      },
    },
  });
}

async function keys(startMs: number, endMs: number) {
  const range = await host.calendarRange({
    startMs,
    endMs,
    startDay: 0,
    endDay: 0,
  });
  if (range.kind !== 'range') throw new Error('Calendar cache is unavailable');
  equal(range.gaps, []);
  equal(range.freshness, 'fresh');
  return range.occurrenceKeys;
}

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

try {
  await write(instant);
  await host.calendarCommit({
    coverage: [{ kind: 'timed', start: pointMs - 1, end: pointMs + 3_600_000 }],
    freshness: 'fresh',
  });
  equal(await keys(pointMs, pointMs + 1), [occurrenceKey]);
  equal(await keys(pointMs - 1, pointMs), []);
  equal(await keys(pointMs, pointMs), []);
  const cached = await host.readQuery({ opKey: 1, query, variables });
  if (cached.kind !== 'hit')
    throw new Error('Point query did not survive normalization');
  const data = cached.data as {
    user: {
      calendarOccurrences: {
        nodes: Array<{ time: { startsAt: string; endsAt: string } }>;
      };
    };
  };
  equal(data.user.calendarOccurrences.nodes[0].time.startsAt, instant);
  equal(data.user.calendarOccurrences.nodes[0].time.endsAt, instant);
  await write('2026-10-08T13:00:00Z');
  equal(await keys(pointMs + 1, pointMs + 2), [occurrenceKey]);
  await write(instant);
  equal(await keys(pointMs + 1, pointMs + 2), []);
  equal(await keys(pointMs, pointMs + 1), [occurrenceKey]);
  result.textContent = JSON.stringify({
    pointVisible: true,
    exactTimePreserved: true,
    exclusiveEnd: true,
    emptyRange: true,
    durationReplacement: true,
  });
  result.dataset.status = 'passed';
} catch (error) {
  result.textContent = String(error);
  result.dataset.status = 'failed';
}
window.addEventListener('pagehide', () => host.dispose(), { once: true });
