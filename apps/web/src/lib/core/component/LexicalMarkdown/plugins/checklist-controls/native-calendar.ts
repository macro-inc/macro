/** Raw host Date observations for the native planner; no calendar bucket policy. */
function localFields(date: Date) {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
    second: date.getSeconds(),
    millisecond: date.getMilliseconds(),
  };
}

function observeValidDate(date: Date) {
  const midnight = new Date(date.getTime());
  midnight.setHours(0, 0, 0, 0);
  return {
    instantMs: date.getTime(),
    local: localFields(date),
    startOfDay: Number.isNaN(midnight.getTime())
      ? { kind: 'invalid' }
      : {
          kind: 'valid',
          instantMs: midnight.getTime(),
          local: localFields(midnight),
        },
  };
}

/** The caller samples today when its provider facts change, never once per edit. */
export function observeChecklistCalendar(
  today: Date,
  dueStrings: Iterable<string>
) {
  if (Number.isNaN(today.getTime()))
    throw new Error('Invalid checklist host date');
  const dueDates = Object.fromEntries(
    Array.from(
      new Set(dueStrings),
      (due): [string, ParsedDueDateObservation] => {
        const date = new Date(due);
        return [
          due,
          Number.isNaN(date.getTime())
            ? { kind: 'invalid' }
            : { kind: 'valid', observation: observeValidDate(date) },
        ];
      }
    )
  );
  return { today: observeValidDate(today), dueDates };
}

type ParsedDueDateObservation =
  | { kind: 'invalid' }
  | { kind: 'valid'; observation: ReturnType<typeof observeValidDate> };
