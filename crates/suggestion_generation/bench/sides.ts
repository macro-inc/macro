// Setting runs side by side: one side of a comparison joined from run
// files, and the checks that two sides read the same people, were judged by
// one judge and were scored against the same answer keys, and (for `noise`)
// ran one build, before any number of one is set beside the other's.

import type { Persona } from './personas';
import type { RunFile } from './score';

/** The digest a run recorded for a persona's workspace and mail, if it recorded one. */
export const digestOf = (run: RunFile, name: string) => (run.personas && Object.hasOwn(run.personas, name) ? run.personas[name] : undefined);

/** The digest of the answer keys a run scored a persona against, if it recorded one. */
export const keyOf = (run: RunFile, name: string) => (run.keys && Object.hasOwn(run.keys, name) ? run.keys[name] : undefined);

/** How an error names persona `name` of `runs`: a held-out person never by name. */
const named = (runs: RunFile[], name: string) => (runs.some((run) => run.attempts.some((attempt) => attempt.persona === name && attempt.heldout)) ? 'a held-out person' : name);

const personasOf = (run: RunFile) => new Set(run.attempts.map((attempt) => attempt.persona));

/** A run's flags as one comparable string: the ones it turned on, in order. */
const flagsOf = (run: RunFile) =>
  Object.entries(run.flags ?? {})
    .filter(([, on]) => on)
    .map(([flag]) => flag)
    .sort()
    .join(',');

/**
 * One side of a comparison: `runs` (read from `arg`, comma-separated) as one
 * run whose reps follow on (the second file's rep 1 is rep 4 after a 3-rep
 * run), so runs pair up rep for rep. A side is one build: its runs share a
 * section, set, judge, commit and flags, and read each persona the same way
 * and scored it against the same answer keys.
 */
export function joinRuns(arg: string, runs: RunFile[]): RunFile {
  // Two runs of unknown builds, or of unrecorded flags, may be two builds.
  if (runs.length > 1 && runs.some((run) => !run.commit || run.commit === 'unknown')) throw new Error(`${arg} joins a run with no commit recorded: a side is one build`);
  if (runs.length > 1 && runs.some((run) => !run.flags)) throw new Error(`${arg} joins a run with no flags recorded: a side is one build`);
  for (const field of ['section', 'set', 'judge', 'commit'] as const) {
    if (new Set(runs.map((run) => run[field])).size > 1) throw new Error(`${arg} mixes ${field}s: a side is one build`);
  }
  if (new Set(runs.map(flagsOf)).size > 1) throw new Error(`${arg} mixes flags: a side is one build`);
  if (runs.length > 1 && runs.some((run) => !run.judge)) throw new Error(`${arg} joins runs with no judge recorded, which may come from different judges`);
  // A persona read two ways, or scored against two keys, can't be one side's.
  const personas = new Map<string, string>();
  const keys = new Map<string, string>();
  for (const run of runs.length > 1 ? runs : []) {
    for (const name of personasOf(run)) {
      const digest = digestOf(run, name);
      if (!digest) throw new Error(`${arg} joins a run with no digest of ${named(runs, name)}, so what its generations read is unknown: run it again`);
      if ((personas.get(name) ?? digest) !== digest) throw new Error(`${arg} joins runs that read ${named(runs, name)}'s workspace or mail differently`);
      personas.set(name, digest);
      const key = keyOf(run, name);
      if (!key) throw new Error(`${arg} joins a run with no digest of ${named(runs, name)}'s answer keys: rescore it to record the keys it is scored against`);
      if ((keys.get(name) ?? key) !== key) throw new Error(`${arg} joins runs scored against different answer keys for ${named(runs, name)}: rescore the older one`);
      keys.set(name, key);
    }
  }
  let offset = 0;
  const attempts = runs.flatMap((run) => {
    const shifted = run.attempts.map((attempt) => ({ ...attempt, rep: attempt.rep + offset }));
    offset += Math.max(0, ...run.attempts.map((attempt) => attempt.rep));
    return shifted;
  });
  return {
    ...runs[0],
    label: [...new Set(runs.map((run) => run.label))].join('+'),
    attempts,
    ...(runs.length > 1 && { personas: Object.fromEntries(personas), keys: Object.fromEntries(keys) }),
  };
}

/** Two sides judged by one judge on the same personas, scored against the same answer keys, or why they can't be set side by side. */
export function comparable(a: RunFile, b: RunFile) {
  for (const side of [a, b]) {
    // Runs from before the judge was recorded may come from different judges too.
    if (!side.judge) throw new Error(`${side.label} has no judge recorded, so its marks may come from another judge: run it again`);
  }
  if (a.judge !== b.judge) {
    throw new Error(`${a.label} and ${b.label} were judged by different judges (${a.judge ?? 'unrecorded'}, ${b.judge ?? 'unrecorded'}): rejudge the older one first`);
  }
  // A changed mailbox or workspace, or a changed answer key, would read as a change of build.
  const inB = personasOf(b);
  for (const name of [...personasOf(a)].filter((name) => inB.has(name))) {
    const [da, db] = [digestOf(a, name), digestOf(b, name)];
    if (!da || !db) throw new Error(`${(da ? b : a).label} has no digest of ${named([a, b], name)}, so what its generations read is unknown: run it again`);
    if (da !== db) throw new Error(`${a.label} and ${b.label} read ${named([a, b], name)}'s workspace or mail differently`);
    const [ka, kb] = [keyOf(a, name), keyOf(b, name)];
    if (!ka || !kb) throw new Error(`${(ka ? b : a).label} has no digest of ${named([a, b], name)}'s answer keys: rejudge it to record the keys it is scored against`);
    if (ka !== kb) throw new Error(`${a.label} and ${b.label} were scored against different answer keys for ${named([a, b], name)}: rejudge the older one`);
  }
}

/** Two sides of one build, as `noise` measures, or why they aren't: the same commit, known, with the same flags. */
export function sameBuild(a: RunFile, b: RunFile) {
  for (const side of [a, b]) {
    if (!side.commit || side.commit === 'unknown') throw new Error(`${side.label} has no commit recorded: noise measures one build against itself`);
    if (!side.flags) throw new Error(`${side.label} has no flags recorded: noise measures one build against itself`);
  }
  if (a.commit !== b.commit) throw new Error(`${a.label} ran ${a.commit} and ${b.label} ran ${b.commit}: noise measures one build against itself`);
  if (flagsOf(a) !== flagsOf(b)) throw new Error(`${a.label} and ${b.label} ran with different flags (${flagsOf(a) || 'none'}; ${flagsOf(b) || 'none'}): noise measures one build against itself`);
}

/**
 * How many of `people` a rescore of `run` can't score from the marks it
 * has. Marks name the key's entries by id, so they hold only for the keys
 * their judge read: the run's recorded keys, which must be the keys as they
 * are now (`keys`). A run from before keys were recorded can't show which
 * keys its marks were judged against, so it is rejudged.
 */
export function staleKeys(run: RunFile, people: Persona[], keys: Record<string, string>): number {
  return people.filter((persona) => run.keys?.[persona.name] !== keys[persona.name]).length;
}
