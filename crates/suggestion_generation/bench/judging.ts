// The order a routines run's held-back attempts are judged in, and how each
// leaves the run file's "not judged" state.

/** What an attempt holds until it is judged: in a run that stopped before judging, `rejudge` judges it. */
export const UNJUDGED = 'not judged: the run stopped before judging it; `rejudge` its run file';

/** An attempt held back for judging, with who generated it and how to log its result. */
export type Waiting<S, A> = { slot: S; attempt: A; log: () => void };

/**
 * Start judging what a routines run held back: each persona's first attempt
 * first, since its judgement writes the cached prefix the others read. The
 * run file is saved as each is judged, and an attempt keeps its marker until
 * its marks, score and cost are all in, so a save another judgement makes
 * meanwhile never shows it half judged.
 */
export function judgeWaiting<S extends { name: string }, A extends { benchError?: string }>(
  waiting: Waiting<S, A>[],
  judge: (slot: S, attempt: A) => Promise<void>,
  save: () => void,
): Promise<void>[] {
  const firsts = waiting.filter((item, i) => waiting.findIndex((other) => other.slot.name === item.slot.name) === i);
  return [...firsts, ...waiting.filter((item) => !firsts.includes(item))].map(({ slot, attempt, log }) =>
    judge(slot, attempt).then(() => {
      if (attempt.benchError === UNJUDGED) attempt.benchError = undefined;
      save();
      log();
    }),
  );
}
