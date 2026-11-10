/** A timed event on the person's calendar today. */
export type DayEvent = {
  id: string;
  title: string;
  /** ISO instants. */
  start: string;
  end: string;
};

/** An event placed on the working-hours strip. */
export type DayChip = {
  event: DayEvent;
  /** Where it starts across the strip, 0 to 100. */
  left: number;
  /** Which of the strip's rows it sits on, so neighbours don't overlap. */
  lane: number;
  /** It has ended. */
  past: boolean;
};

export type DayStrip = {
  /** The hours labelled along the top, e.g. 8, 10, 12. */
  hours: number[];
  chips: DayChip[];
  /** Where now is across the strip; undefined outside working hours. */
  now: number | undefined;
};

export const WORKING_HOURS = { start: 8, end: 20 };

/** A chip's width as a share of the strip, for spacing neighbours apart. */
const CHIP_SPAN = 14;
const LANES = 2;

/**
 * Today's timed events across working hours. An event that starts before the
 * strip sits at its left edge; ones wholly outside it are left out. Each chip
 * takes the first row where it clears the chip before it.
 */
export function layoutDay(events: DayEvent[], now: Date): DayStrip {
  const dayStart = new Date(now);
  dayStart.setHours(WORKING_HOURS.start, 0, 0, 0);
  const dayEnd = new Date(now);
  dayEnd.setHours(WORKING_HOURS.end, 0, 0, 0);
  const span = dayEnd.getTime() - dayStart.getTime();
  const across = (time: number) => ((time - dayStart.getTime()) / span) * 100;

  const laneEnds = Array.from({ length: LANES }, () => -Infinity);
  const chips: DayChip[] = [];
  const sorted = events
    .filter(
      (event) =>
        Date.parse(event.end) > dayStart.getTime() &&
        Date.parse(event.start) < dayEnd.getTime()
    )
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));

  for (const event of sorted) {
    const left = Math.max(0, across(Date.parse(event.start)));
    const free = laneEnds.findIndex((end) => end <= left);
    // Every row taken: share the row that frees up first.
    const lane = free === -1 ? laneEnds.indexOf(Math.min(...laneEnds)) : free;
    laneEnds[lane] = left + CHIP_SPAN;
    chips.push({
      event,
      left,
      lane,
      past: Date.parse(event.end) <= now.getTime(),
    });
  }

  const hours: number[] = [];
  for (let hour = WORKING_HOURS.start; hour <= WORKING_HOURS.end; hour += 2) {
    hours.push(hour);
  }
  const nowAcross = across(now.getTime());

  return {
    hours,
    chips,
    now: nowAcross >= 0 && nowAcross <= 100 ? nowAcross : undefined,
  };
}
