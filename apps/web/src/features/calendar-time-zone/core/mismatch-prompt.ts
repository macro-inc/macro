/** The zones a device sees: its own clock's and its primary calendar's. */
export type ZonePair = {
  /** IANA zone of the user's primary calendar. */
  calendarZone: string;
  /** IANA zone this device keeps time in. */
  deviceZone: string;
};

/**
 * What the mismatch prompt remembers on one device: the single mismatch the
 * user dismissed, or nothing. One slot, never a history, so a dismissal only
 * covers the mismatch the user is in when they dismiss it.
 */
export type Dismissal = ZonePair | null;

/** Whether to show the prompt, and what to remember after this observation. */
export type PromptDecision = { show: boolean; dismissal: Dismissal };

function samePair(a: ZonePair, b: ZonePair): boolean {
  return a.calendarZone === b.calendarZone && a.deviceZone === b.deviceZone;
}

/**
 * Decide from the zones observed now. A dismissal holds only while the
 * observed pair stays the one dismissed; any change (another device zone,
 * another calendar zone, or the zones agreeing) clears it, so a later return
 * to the same mismatch asks again.
 */
export function observeZones(
  observed: ZonePair,
  dismissal: Dismissal
): PromptDecision {
  if (observed.calendarZone === observed.deviceZone) {
    return { show: false, dismissal: null };
  }
  if (dismissal && samePair(dismissal, observed)) {
    return { show: false, dismissal };
  }
  return { show: true, dismissal: null };
}

/** The user dismissed the prompt for the mismatch they are in. */
export function dismissMismatch(observed: ZonePair): Dismissal {
  return { ...observed };
}
