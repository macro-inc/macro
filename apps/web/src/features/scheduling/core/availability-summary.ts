import {
  type AvailabilityHours,
  availabilityRuleHours,
  normalizeAvailabilityHours,
} from './availability-selection';
import type { AvailabilitySchedule } from './types';

export type AvailabilityWeekGroup = {
  days: number[];
  hours: AvailabilityHours;
};

/** Group consecutive Monday-first weekdays with identical complete hours. */
export function availabilityWeekGroups(
  schedule: AvailabilitySchedule
): AvailabilityWeekGroup[] {
  const groups: AvailabilityWeekGroup[] = [];
  for (let index = 0; index < 7; index++) {
    const day = (index + 1) % 7;
    const hours = normalizeAvailabilityHours(
      availabilityRuleHours(schedule, { kind: 'weekly', day })
    );
    const previous = groups.at(-1);
    if (previous && JSON.stringify(previous.hours) === JSON.stringify(hours)) {
      previous.days.push(day);
    } else {
      groups.push({ days: [day], hours });
    }
  }
  return groups;
}
