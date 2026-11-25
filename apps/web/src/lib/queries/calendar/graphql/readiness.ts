// A host answers nothing until its engine has started, and a start that fails
// can take minutes to give up, so callers wait on a host only once it has
// answered a calendar read.
const answeredHosts = new WeakSet<object>();

/**
 * How long a host that has not answered a calendar read yet gets before a
 * calendar view reads from REST. A healthy browser cache starts in about 0.4s
 * at the median; one that fails to start can take minutes to give up.
 */
export const CALENDAR_CACHE_HEAD_START_MS = 1_000;

/**
 * How long a calendar view waits on the cache path before a REST read races
 * it. A covered week answers in milliseconds and an uncovered one in about a
 * network round trip, while a cache waiting for another tab to hand over its
 * database can hold a read for minutes.
 */
export const CALENDAR_CACHE_READ_DEADLINE_MS = 3_000;

export function markCalendarCacheAnswered(host: object): void {
  answeredHosts.add(host);
}

export function calendarCacheAnswered(host: object): boolean {
  return answeredHosts.has(host);
}

// Viewports REST has answered on this page. Each one shows the server's state
// at that moment, which a week the cache covered earlier can predate.
let restAnswers = 0;

/** Records a viewport answered from REST rather than the cache. */
export function recordCalendarRestAnswer(): void {
  restAnswers += 1;
}

/** How many viewports REST has answered on this page so far. */
export function calendarRestAnswers(): number {
  return restAnswers;
}

/** The read's result if it settles within `ms`, else `deadline`. */
export async function withinDeadline<T>(
  read: PromiseLike<T>,
  ms: number
): Promise<T | 'deadline'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<'deadline'>((resolve) => {
    timer = setTimeout(() => resolve('deadline'), ms);
  });
  try {
    return await Promise.race([read, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** The read's result if it settles within the head start, else `not-ready`. */
export async function withinCacheHeadStart<T>(
  read: Promise<T>,
  headStartMs = CALENDAR_CACHE_HEAD_START_MS
): Promise<T | 'not-ready'> {
  const result = await withinDeadline(read, headStartMs);
  return result === 'deadline' ? 'not-ready' : result;
}
