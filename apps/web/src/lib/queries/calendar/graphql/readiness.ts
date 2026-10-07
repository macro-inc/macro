// A host answers nothing until its engine has started, and a start that fails
// can take minutes to give up, so callers wait on a host only once it has
// answered a calendar read.
const answeredHosts = new WeakSet<object>();

export function markCalendarCacheAnswered(host: object): void {
  answeredHosts.add(host);
}

export function calendarCacheAnswered(host: object): boolean {
  return answeredHosts.has(host);
}
