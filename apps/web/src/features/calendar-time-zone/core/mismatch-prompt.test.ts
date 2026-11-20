import { describe, expect, it } from 'vitest';
import {
  type Dismissal,
  dismissMismatch,
  observeZones,
  type ZonePair,
} from './mismatch-prompt';

const ROME_CALENDAR_IN_NEW_YORK: ZonePair = {
  calendarZone: 'Europe/Rome',
  deviceZone: 'America/New_York',
};

/** Feed observations in order, the way the app would on each check. */
function replay(
  observations: ZonePair[],
  dismissal: Dismissal
): { shown: boolean[]; dismissal: Dismissal } {
  const shown: boolean[] = [];
  let remembered = dismissal;
  for (const observed of observations) {
    const decision = observeZones(observed, remembered);
    shown.push(decision.show);
    remembered = decision.dismissal;
  }
  return { shown, dismissal: remembered };
}

describe('calendar time zone mismatch prompt', () => {
  it('asks when the calendar and device zones differ', () => {
    expect(observeZones(ROME_CALENDAR_IN_NEW_YORK, null).show).toBe(true);
  });

  it('stays quiet for the same mismatch after a dismissal', () => {
    const dismissal = dismissMismatch(ROME_CALENDAR_IN_NEW_YORK);

    const { shown, dismissal: remembered } = replay(
      [ROME_CALENDAR_IN_NEW_YORK, ROME_CALENDAR_IN_NEW_YORK],
      dismissal
    );

    expect(shown).toEqual([false, false]);
    expect(remembered).toEqual(ROME_CALENDAR_IN_NEW_YORK);
  });

  it('asks again on returning to a dismissed mismatch after the device zone changed', () => {
    const dismissal = dismissMismatch(ROME_CALENDAR_IN_NEW_YORK);

    const { shown } = replay(
      [
        { calendarZone: 'Europe/Rome', deviceZone: 'America/Los_Angeles' },
        ROME_CALENDAR_IN_NEW_YORK,
      ],
      dismissal
    );

    expect(shown).toEqual([true, true]);
  });

  it('clears the dismissal once the zones match', () => {
    const dismissal = dismissMismatch(ROME_CALENDAR_IN_NEW_YORK);

    const { shown, dismissal: remembered } = replay(
      [
        { calendarZone: 'Europe/Rome', deviceZone: 'Europe/Rome' },
        ROME_CALENDAR_IN_NEW_YORK,
      ],
      dismissal
    );

    expect(shown).toEqual([false, true]);
    expect(remembered).toBeNull();
  });

  it('asks again when the calendar zone changes', () => {
    const dismissal = dismissMismatch(ROME_CALENDAR_IN_NEW_YORK);

    const { shown } = replay(
      [{ calendarZone: 'Europe/Paris', deviceZone: 'America/New_York' }],
      dismissal
    );

    expect(shown).toEqual([true]);
  });

  it('remembers only the latest dismissal', () => {
    const inLosAngeles: ZonePair = {
      calendarZone: 'Europe/Rome',
      deviceZone: 'America/Los_Angeles',
    };
    let dismissal = dismissMismatch(ROME_CALENDAR_IN_NEW_YORK);
    dismissal = observeZones(inLosAngeles, dismissal).dismissal;
    dismissal = dismissMismatch(inLosAngeles);

    expect(dismissal).toEqual(inLosAngeles);
    expect(observeZones(ROME_CALENDAR_IN_NEW_YORK, dismissal).show).toBe(true);
  });
});
