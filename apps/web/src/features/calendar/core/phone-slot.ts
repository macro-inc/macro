import { addDays, addHours } from 'date-fns';

/** A phone slot tap selects one hour, or one exclusive calendar day. */
export function phoneSlotRange(start: Date, allDay: boolean) {
  return {
    start,
    end: allDay ? addDays(start, 1) : addHours(start, 1),
    allDay,
  };
}
