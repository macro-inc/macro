export const SEND_LATER_DEFAULT_TIME = { hours: 8, minutes: 0 } as const;

/** The send-later menu's suggestions, relative to the supplied time. */
export function sendLaterPresets(now: Date) {
  const daysUntilMonday = (8 - now.getDay()) % 7 || 7;
  const day = (offset: number, hours: number) =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, hours);
  return [
    {
      id: 'tomorrow-morning',
      label: 'Tomorrow morning',
      date: day(1, SEND_LATER_DEFAULT_TIME.hours),
    },
    { id: 'tomorrow-afternoon', label: 'Tomorrow afternoon', date: day(1, 13) },
    {
      id: 'monday-morning',
      label: 'Monday morning',
      date: day(daysUntilMonday, SEND_LATER_DEFAULT_TIME.hours),
    },
  ];
}
