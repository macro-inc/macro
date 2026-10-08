interface DisplayEvent {
  id: string;
  calendar: { id: string };
  teamProjection?: { ownerId: string };
}

/** Keep direct-copy interactions authoritative; the team source supersedes its OOO overlay. */
export function mergeCalendarOverlays<T extends DisplayEvent>(
  own: T[],
  outOfOffice: T[],
  shared: T[]
): T[] {
  const ownIds = new Set(own.map((event) => event.id));
  const sharedOwners = new Set(
    shared.flatMap((event) =>
      event.teamProjection ? [event.teamProjection.ownerId] : []
    )
  );
  return [
    ...own,
    ...outOfOffice.filter(
      (event) =>
        !ownIds.has(event.id) &&
        !sharedOwners.has(event.calendar.id.replace(/^team-ooo:/, ''))
    ),
    ...shared.filter((event) => !ownIds.has(event.id)),
  ];
}
