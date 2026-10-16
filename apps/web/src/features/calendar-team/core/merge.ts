interface DisplayEvent {
  id: string;
}

/** Keep direct-copy interactions authoritative over a teammate's OOO overlay. */
export function mergeCalendarOverlays<T extends DisplayEvent>(
  own: T[],
  outOfOffice: T[]
): T[] {
  const ownIds = new Set(own.map((event) => event.id));
  return [...own, ...outOfOffice.filter((event) => !ownIds.has(event.id))];
}
