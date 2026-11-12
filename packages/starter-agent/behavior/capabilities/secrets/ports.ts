import type { Schedules } from '@macro-inc/muppet/utilities/schedules';
import type { Clipboard } from './clipboard.ts';
import { pollEvery, pollSchedule } from './config.ts';
import type { Vault } from './vault.ts';

/** What the secrets area adds to the context, under one name: the vault, the clipboard, and its polling. */
export type SecretsPorts = {
  readonly vault: Vault;
  readonly clipboard: Clipboard;
  /** Milliseconds on a clock that only goes forward (performance.now), for timing a code's round trip. */
  readonly monotonic: () => number;
  /** The schedule that checks pending access requests: on while any is pending. */
  readonly polling: {
    readonly ensure: () => Promise<void>;
    readonly stop: () => Promise<void>;
  };
};

/** Polling as a standing schedule: set while anything is pending, removed when nothing is. */
export const polling = (
  schedules: Pick<Schedules, 'set' | 'list' | 'remove'>
): SecretsPorts['polling'] => {
  const listed = async () =>
    (await schedules.list()).some(({ name }) => name === pollSchedule);
  return {
    ensure: async () => {
      if (await listed()) return;
      const set = await schedules.set(pollSchedule, {
        every: pollEvery,
        why: 'Asks the vault whether the owner has decided on access the agent requested.',
      });
      if (set.kind === 'invalid') throw new Error(set.error);
    },
    stop: async () => {
      if (await listed()) await schedules.remove(pollSchedule);
    },
  };
};
