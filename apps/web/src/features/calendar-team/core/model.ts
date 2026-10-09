/** Team sharing is a Macro read permission, separate from Google permissions. */
export type CalendarSharing = 'busy_only' | 'all' | 'none';

export interface CalendarTeamMember {
  userId: string;
  sharing: CalendarSharing;
  coverage: 'ready' | 'unavailable' | 'hidden';
}

export interface CalendarTeamMemberDisplay extends CalendarTeamMember {
  name: string;
  color: string;
  sourceId: string;
}

export const TEAM_CALENDAR_SOURCE = 'team-calendar';

export function teamCalendarSourceId(ownerId: string) {
  return `${TEAM_CALENDAR_SOURCE}:${ownerId}`;
}

/** The source and owner scope prevent collisions with a directly accessible copy. */
export function teamCalendarRenderId(ownerId: string, projectionId: string) {
  return JSON.stringify([TEAM_CALENDAR_SOURCE, ownerId, projectionId]);
}

export function teamCalendarColor(ownerId: string) {
  const colors = [
    'var(--color-accent)',
    'var(--color-ink-muted)',
    'var(--color-success)',
    'var(--color-alert)',
  ];
  let hash = 0;
  for (const character of ownerId)
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return colors[hash % colors.length];
}

export function teamMemberStatus(member: CalendarTeamMember): string {
  if (member.coverage === 'hidden' || member.sharing === 'none')
    return 'Not shared';
  if (member.coverage === 'unavailable') return 'Calendar unavailable';
  return member.sharing === 'all' ? 'Event details' : 'Busy blocks';
}

export function canShowTeamMember(member: CalendarTeamMember) {
  return member.coverage === 'ready' && member.sharing !== 'none';
}
