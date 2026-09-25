import type { MeetingSessionLifecycle } from '../context/meeting-session-lifecycle';

async function waitForBoth(previous: Promise<void>, current: Promise<void>) {
  await Promise.all([previous, current]);
}

/** Keep unfinished attempts and cleanup alive across individual route owners. */
export function createMeetingSessionLifecycle(): MeetingSessionLifecycle {
  let pending = Promise.resolve();
  return {
    begin() {
      const previous = pending;
      let complete!: () => void;
      const current = new Promise<void>((resolve) => {
        complete = resolve;
      });
      // A leave can finish before its cancelled token request. Both must settle
      // before another owner may request credentials for the same RTC identity.
      pending = waitForBoth(previous, current);
      return { previous, complete };
    },
  };
}
