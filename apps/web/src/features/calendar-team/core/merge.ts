interface DisplayEvent {
  id: string;
}

/** Keep direct-copy interactions authoritative over a teammate's OOO overlay. */
export function mergeCalendarOverlays<T extends DisplayEvent>(
  own: T[],
  outOfOffice: T[]
): T[] {
  if (outOfOffice.length === 0) return own;
  if (own.length === 0) return outOfOffice;
  const ownIds = new Set(own.map((event) => event.id));
  return [...own, ...outOfOffice.filter((event) => !ownIds.has(event.id))];
}
