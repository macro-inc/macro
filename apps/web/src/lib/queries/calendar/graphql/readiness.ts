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

export function markCalendarCacheAnswered(host: object): void {
  answeredHosts.add(host);
}

export function calendarCacheAnswered(host: object): boolean {
  return answeredHosts.has(host);
}

/** The read's result if it settles within the head start, else `not-ready`. */
export async function withinCacheHeadStart<T>(
  read: Promise<T>,
  headStartMs = CALENDAR_CACHE_HEAD_START_MS
): Promise<T | 'not-ready'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const headStart = new Promise<'not-ready'>((resolve) => {
    timer = setTimeout(() => resolve('not-ready'), headStartMs);
  });
  try {
    return await Promise.race([read, headStart]);
  } finally {
    clearTimeout(timer);
  }
}
