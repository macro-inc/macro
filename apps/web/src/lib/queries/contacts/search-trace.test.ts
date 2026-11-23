import { hashKey } from '@tanstack/solid-query';
import { match } from 'ts-pattern';
import { afterEach, expect, it, vi } from 'vitest';
import type {
  ContactDirectoryCursor,
  ContactDirectoryPage,
  readContactDirectory,
} from './directory';
import { createContactSearchTrace } from './search-trace';

const telemetry = vi.hoisted(() => {
  type Recorded = {
    name: string;
    attributes: Record<string, unknown>;
    startTime: number | undefined;
    endTime: number | undefined;
    children: number;
  };
  const spans: Recorded[] = [];
  let active: Recorded | undefined;
  return {
    spans,
    /** The search span a page read ran under. */
    parent: () => active,
    span: (
      name: string,
      options: { startTime?: number; attributes?: Record<string, unknown> }
    ) => {
      const recorded: Recorded = {
        name,
        attributes: { ...options.attributes },
        startTime: options.startTime,
        endTime: undefined,
        children: 0,
      };
      spans.push(recorded);
      return {
        run: <T>(operation: () => T) => {
          active = recorded;
          try {
            return operation();
          } finally {
            active = undefined;
          }
        },
        setAttr: (key: string, value: unknown) => {
          recorded.attributes[key] = value;
        },
        end: (time?: number) => {
          recorded.endTime ??= time;
        },
      };
    },
  };
});

vi.mock('@macro-inc/observability', () => ({
  Telemetry: { span: telemetry.span },
}));

afterEach(() => {
  telemetry.spans.length = 0;
  vi.useRealTimers();
});

const VIEWER = 'macro|viewer@example.com';
const SIGNAL = new AbortController().signal;

function person(index: number) {
  return {
    id: `macro|person${index}@example.com`,
    email: `person${index}@example.com`,
    name: `Person ${index}`,
  };
}

function cursor(query: string, after: number): ContactDirectoryCursor {
  return {
    source: 'server',
    userId: VIEWER,
    query,
    after: String(after),
    policyKey: hashKey([undefined]),
  };
}

/** Server pages for `query`: rows on the first and last, empty between. */
function scanningReader(query: string, pages: number, ms = 10) {
  return vi
    .fn<typeof readContactDirectory>()
    .mockImplementation(async (_viewer, _host, request) => {
      const parent = telemetry.parent();
      if (parent) parent.children += 1;
      await new Promise((resolve) => setTimeout(resolve, ms));
      const at = request.cursor ? Number(request.cursor.after) : 0;
      const last = at === pages - 1;
      return {
        query: request.query,
        source: 'server',
        sync: 'unavailable',
        offline: false,
        users: at === 0 || last ? [person(at)] : [],
        nextCursor: last ? null : cursor(query, at + 1),
      } satisfies ContactDirectoryPage;
    });
}

async function readPages(
  read: typeof readContactDirectory,
  query: string,
  pages: number[]
) {
  for (const at of pages) {
    const page = read(
      VIEWER,
      undefined,
      { query, cursor: at ? cursor(query, at) : undefined },
      SIGNAL
    );
    await vi.advanceTimersByTimeAsync(10);
    await page;
  }
}

it('records one span per search with its pages, empty run, source and end', async () => {
  vi.useFakeTimers();
  const reader = scanningReader('rare', 6);
  const trace = createContactSearchTrace(reader, 500, (users) => users);
  await readPages(trace.read, 'rare', [0, 1, 2, 3, 4, 5]);

  expect(telemetry.spans).toHaveLength(1);
  const [search] = telemetry.spans;
  expect(search.name).toBe('contacts.search');
  // Every page read ran under the search span.
  expect(search.children).toBe(6);
  expect(search.attributes).toEqual({
    'contacts.mode': 'property',
    'contacts.query_length': 4,
    'contacts.repeat': false,
    'contacts.outcome': 'end',
    'contacts.reached_end': true,
    'contacts.source': 'server',
    'contacts.pages': 6,
    'contacts.server_pages': 6,
    'contacts.server_ms': 60,
    'contacts.failed_pages': 0,
    'contacts.empty_pages': 4,
    'contacts.max_empty_run': 4,
    'contacts.max_empty_run_ms': 40,
    'contacts.listed': 2,
    'contacts.elapsed_ms': 60,
  });
  expect(search.endTime! - search.startTime!).toBe(60);

  // A re-read after a contact change is a new search marked as a repeat. The
  // list still shows the rows read before, so pages that list none of them
  // anew are empty, scan included.
  await readPages(trace.read, 'rare', [0, 1, 2]);
  trace.close();
  expect(telemetry.spans).toHaveLength(2);
  expect(telemetry.spans[1].attributes).toMatchObject({
    'contacts.repeat': true,
    'contacts.outcome': 'closed',
    'contacts.pages': 3,
    'contacts.max_empty_run': 3,
    'contacts.listed': 2,
  });
  expect(telemetry.spans[1].children).toBe(3);

  // Reopened after closing, the list starts over from page one.
  await readPages(trace.read, 'rare', [0, 1]);
  trace.close();
  expect(telemetry.spans[2].attributes).toMatchObject({
    'contacts.repeat': true,
    'contacts.pages': 2,
    'contacts.max_empty_run': 1,
    'contacts.listed': 1,
  });
});

it('ends a search when the query changes or the list closes, before its end', async () => {
  vi.useFakeTimers();
  const reader = scanningReader('', 10);
  const trace = createContactSearchTrace(reader, 500, (users) => users);
  await readPages(trace.read, 'ra', [0]);
  await readPages(trace.read, 'rar', [0]);
  // Time spent open after the last page is not part of the search.
  await vi.advanceTimersByTimeAsync(5000);
  trace.close();

  expect(telemetry.spans.map((span) => span.attributes)).toMatchObject([
    {
      'contacts.outcome': 'changed',
      'contacts.reached_end': false,
      'contacts.pages': 1,
      'contacts.elapsed_ms': 10,
    },
    {
      'contacts.outcome': 'closed',
      'contacts.reached_end': false,
      'contacts.pages': 1,
      'contacts.elapsed_ms': 10,
    },
  ]);
});

it('counts a page with only ineligible or already listed rows as empty, and ends at the bound', async () => {
  vi.useFakeTimers();
  const reader = vi
    .fn<typeof readContactDirectory>()
    .mockImplementation(async (_viewer, _host, request) => ({
      query: request.query,
      source: 'cache',
      sync: 'snapshot',
      offline: false,
      users: match(request.cursor?.after)
        .with(undefined, () => [person(0), person(1), person(2)])
        .with('1', () => [person(0), person(1)])
        .otherwise(() => [person(3)]),
      nextCursor: cursor(request.query, Number(request.cursor?.after ?? 0) + 1),
    }));
  const trace = createContactSearchTrace(reader, 3, (users) =>
    users.filter((user) => user.id !== person(1).id)
  );
  await readPages(trace.read, '', [0, 1, 2]);
  expect(telemetry.spans).toHaveLength(1);
  expect(telemetry.spans[0].attributes).toMatchObject({
    'contacts.source': 'cache',
    'contacts.server_pages': 0,
    'contacts.empty_pages': 1,
    'contacts.max_empty_run': 1,
    'contacts.outcome': 'bound',
    'contacts.listed': 3,
  });
});

it('lists pages as the list does when page one is read again', async () => {
  vi.useFakeTimers();
  let firstPage = [person(0), person(1)];
  const reader = vi
    .fn<typeof readContactDirectory>()
    .mockImplementation(async (_viewer, _host, request) => ({
      query: request.query,
      source: 'cache',
      sync: 'partial',
      offline: false,
      users: request.cursor ? [person(1), person(2)] : firstPage,
      nextCursor: cursor(request.query, 1),
    }));
  const trace = createContactSearchTrace(reader, 500, (users) => users);
  await readPages(trace.read, '', [0]);
  // A contact change re-reads page one without a row listed before.
  firstPage = [person(0)];
  await readPages(trace.read, '', [0, 1]);
  trace.close();
  // The next page lists that row again, so it is not empty.
  expect(telemetry.spans).toHaveLength(1);
  expect(telemetry.spans[0].attributes).toMatchObject({
    'contacts.pages': 3,
    'contacts.empty_pages': 0,
    'contacts.listed': 3,
  });
});

it('ends a re-read at the bound when the list already holds it', async () => {
  vi.useFakeTimers();
  const reader = vi
    .fn<typeof readContactDirectory>()
    .mockImplementation(async (_viewer, _host, request) => ({
      query: request.query,
      source: 'cache',
      sync: 'snapshot',
      offline: false,
      users: request.cursor ? [person(2), person(3)] : [person(0), person(1)],
      nextCursor: cursor(request.query, 1),
    }));
  const trace = createContactSearchTrace(reader, 4, (users) => users);
  await readPages(trace.read, '', [0, 1]);
  // A contact change re-reads page one; the later rows stay listed.
  await readPages(trace.read, '', [0]);
  expect(telemetry.spans.map((span) => span.attributes)).toMatchObject([
    { 'contacts.outcome': 'bound', 'contacts.listed': 4 },
    {
      'contacts.repeat': true,
      'contacts.outcome': 'bound',
      'contacts.pages': 1,
      'contacts.listed': 4,
    },
  ]);
});

it('drops a continuation that lands after page one was read again', async () => {
  vi.useFakeTimers();
  const reader = vi
    .fn<typeof readContactDirectory>()
    .mockImplementation(async (_viewer, _host, request) => {
      // The continuation is slow; page one answers at once.
      await new Promise((resolve) =>
        setTimeout(resolve, request.cursor ? 50 : 0)
      );
      return {
        query: request.query,
        source: 'server',
        sync: 'unavailable',
        offline: false,
        users: request.cursor ? [person(9)] : [person(0)],
        nextCursor: request.cursor ? null : cursor(request.query, 1),
      };
    });
  const trace = createContactSearchTrace(reader, 500, (users) => users);
  await readPages(trace.read, '', [0]);
  const stale = trace.read(
    VIEWER,
    undefined,
    { query: '', cursor: cursor('', 1) },
    SIGNAL
  );
  await readPages(trace.read, '', [0]);
  await vi.advanceTimersByTimeAsync(50);
  await stale;
  trace.close();
  expect(telemetry.spans).toHaveLength(1);
  expect(telemetry.spans[0].attributes).toMatchObject({
    'contacts.outcome': 'closed',
    'contacts.pages': 2,
    'contacts.listed': 1,
  });
});
