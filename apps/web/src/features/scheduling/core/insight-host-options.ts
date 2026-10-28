import type { Booking, EventType, SchedulingMember } from './types';

export type InsightHostOption = {
  value: string;
  label: string;
  email?: string;
};

export function insightHostSelection(
  options: InsightHostOption[],
  value: string,
  previous?: InsightHostOption
): InsightHostOption {
  return (
    options.find((option) => option.value === value) ??
    (previous?.value === value ? previous : undefined) ?? {
      value,
      label: value === 'all' ? 'All hosts' : 'Former member',
    }
  );
}

export function insightHostOptions(
  members: SchedulingMember[],
  events: Pick<EventType, 'hosts'>[],
  bookings: Pick<Booking, 'hosts'>[]
): InsightHostOption[] {
  const hosts = new Map<string, InsightHostOption>(
    members.map((member) => [
      member.id,
      {
        value: member.id,
        label: member.name || member.email,
        email: member.email,
      },
    ])
  );
  for (const source of [events, bookings]) {
    for (const item of source) {
      for (const id of item.hosts) {
        if (!hosts.has(id))
          hosts.set(id, { value: id, label: 'Former member' });
      }
    }
  }
  return [{ value: 'all', label: 'All hosts' }, ...hosts.values()];
}
