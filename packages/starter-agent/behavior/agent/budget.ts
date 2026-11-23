/**
 * What the agent may spend: a cap on each run, and a cap on each of its
 * owner's days. Every finished run's cost goes in a ledger on disk, so a
 * restart forgets nothing, and once a day's spend reaches the cap no wake
 * starts until the owner's next day. The owner is told once that day.
 *
 * The daily cap is checked before a wake, against runs that have finished, so
 * a day can end over its cap by at most what the runs in flight spend, each
 * held to the per-run cap. A run that times out reports no cost and is not in
 * the ledger.
 */
import type { Agent, Woke } from '@macro-inc/muppet/core/agent';
import { type Clock, isoText } from '@macro-inc/muppet/utilities/time';
import { z } from 'zod';
import { type Disk, jsonLine, parseLines } from '../context/disk.ts';

export type Caps = {
  /** No run spends more than this, whatever its profile allows. */
  readonly perRunUsd: number;
  /** Once the owner's day has spent this, nothing wakes until the next day. */
  readonly perDayUsd: number;
};

/** The caps when `agent.json` doesn't set them. */
export const defaultCaps: Caps = { perRunUsd: 5, perDayUsd: 50 };

/** The caps `agent.json` sets, or the defaults. */
export const capsOf = (settings: {
  readonly budgetUsdPerRun?: number | undefined;
  readonly budgetUsdPerDay?: number | undefined;
}): Caps => ({
  perRunUsd: settings.budgetUsdPerRun ?? defaultCaps.perRunUsd,
  perDayUsd: settings.budgetUsdPerDay ?? defaultCaps.perDayUsd,
});

/** A profile whose runs never spend more than `perRunUsd`. */
export const capped =
  <Event, Limits extends { readonly budgetUsd: number }>(
    profile: (event: Event) => Limits,
    perRunUsd: number
  ) =>
  (event: Event): Limits => {
    const limits = profile(event);
    return { ...limits, budgetUsd: Math.min(limits.budgetUsd, perRunUsd) };
  };

/** One finished run in the ledger. */
export const Spend = z.object({
  at: z.string(),
  event: z.string(),
  costUsd: z.number().nonnegative(),
  sessionId: z.string().optional(),
});
export type Spend = z.infer<typeof Spend>;

export type Ledger = {
  readonly add: (day: Temporal.PlainDate, spend: Spend) => Promise<void>;
  /** What the runs of that day spent, in USD. */
  readonly spent: (day: Temporal.PlainDate) => Promise<number>;
  /** The last day the owner was told its cap was reached, so a restart doesn't tell them again. */
  readonly told: {
    readonly read: () => Promise<string | undefined>;
    readonly write: (day: Temporal.PlainDate) => Promise<void>;
  };
};

const toldFile = 'told';
const dayFile = (day: Temporal.PlainDate): string => `${day.toString()}.jsonl`;

/** The ledger as files in `directory`: one JSON Lines file per day, appended to and never rewritten. */
export const fileLedger = ({
  disk,
  join,
  directory,
}: {
  readonly disk: Pick<Disk, 'read' | 'write' | 'append'>;
  readonly join: (...parts: readonly string[]) => string;
  readonly directory: string;
}): Ledger => ({
  add: (day, spend) =>
    disk.append(join(directory, dayFile(day)), jsonLine(spend)),
  spent: async (day) =>
    parseLines(Spend, await disk.read(join(directory, dayFile(day)))).reduce(
      (sum, { costUsd }) => sum + costUsd,
      0
    ),
  told: {
    read: async () =>
      (await disk.read(join(directory, toldFile)))?.trim() || undefined,
    write: (day) =>
      disk.write(join(directory, toldFile), `${day.toString()}\n`),
  },
});

/** The owner's calendar day at `now`. */
const dayAt = (now: Temporal.Instant, timeZone: string): Temporal.PlainDate =>
  now.toZonedDateTimeISO(timeZone).toPlainDate();

/** What Claude's `record` reports when a run ends; anything else it records is not a spend. */
const Finished = z.object({
  event: z.string(),
  session_id: z.string().optional(),
  cost_usd: z.number().nonnegative(),
});

/** A `record` for the agent: each finished run with a cost becomes a line in the ledger. */
export const recordSpend =
  ({
    ledger,
    clock,
    timeZone,
  }: {
    readonly ledger: Pick<Ledger, 'add'>;
    readonly clock: Pick<Clock, 'now'>;
    readonly timeZone: string;
  }) =>
  async (entry: object): Promise<void> => {
    const finished = Finished.safeParse(entry);
    if (!finished.success) return;
    const now = clock.now();
    const { event, session_id: sessionId, cost_usd: costUsd } = finished.data;
    await ledger.add(dayAt(now, timeZone), {
      at: isoText(now),
      event,
      costUsd,
      ...(sessionId === undefined ? {} : { sessionId }),
    });
  };

/** How a refused wake's error starts: the first of the day, which is the one to tell the owner, and the rest. */
const noticePrefix = 'budget: ';
const repeatPrefix = 'budget (already told): ';

const dollars = (usd: number): string => `$${usd.toFixed(2)}`;

/** Whether a wake's error is the budget refusing it: the wake never ran. */
export const budgetRefused = (error: string): boolean =>
  error.startsWith(noticePrefix) || error.startsWith(repeatPrefix);

/** The line for the owner when a wake was refused for the first time today, or undefined for any other failure. */
export const budgetNotice = (error: string): string | undefined =>
  error.startsWith(noticePrefix) ? error.slice(noticePrefix.length) : undefined;

/**
 * The agent, held to the daily cap. A wake on a day that has spent the cap
 * isn't started: it fails, so the runtime fires `hooks.failed`, and only the
 * first such failure of the day carries a `budgetNotice`.
 */
export const budgeted = ({
  agent,
  ledger,
  caps,
  clock,
  timeZone,
}: {
  readonly agent: Agent;
  readonly ledger: Ledger;
  readonly caps: Pick<Caps, 'perDayUsd'>;
  readonly clock: Pick<Clock, 'now'>;
  readonly timeZone: string;
}): Agent => {
  // One check at a time, so two wakes refused together don't both tell the owner.
  let checking: Promise<unknown> = Promise.resolve();
  const refusal = async (): Promise<Woke | undefined> => {
    const day = dayAt(clock.now(), timeZone);
    const spent = await ledger.spent(day);
    if (spent < caps.perDayUsd) return undefined;
    const why = `I've spent ${dollars(spent)} today, which reaches my daily cap of ${dollars(caps.perDayUsd)} (budgetUsdPerDay in agent.json), so I won't wake again until midnight (${timeZone}).`;
    if ((await ledger.told.read()) === day.toString())
      return { kind: 'failed', error: `${repeatPrefix}${why}` };
    await ledger.told.write(day);
    return { kind: 'failed', error: `${noticePrefix}${why}` };
  };
  return {
    wake: async (wake) => {
      const decided = checking.then(refusal);
      checking = decided.catch(() => undefined);
      return (await decided) ?? agent.wake(wake);
    },
  };
};
