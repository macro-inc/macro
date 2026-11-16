// What makes the job fail: the ledger against the runs that were made.
//
// Every function (on each provider it exists for) and every row of the
// manifest is either tested or waived in `waivers.tsv`. What is tested is
// the per-test stack's to cover, unless `full-stack-only.tsv` says the
// full-stack tier's. A job runs one of the two, so each is held to its own.

import type { Ledger } from './ledger';
import type { EmailFunction, Waiver } from './manifest/functions';
import type { Provider } from './manifest/types';
import type { Run } from './paths';

/** A function on a provider (`F-050 gmail`) or a row (`AL-012`). */
type Item = string;

type GatingRun = Exclude<Run, 'known-bugs'>;

export const STACK: Record<GatingRun, string> = {
  gating: 'the per-test stack',
  'full-stack': 'the full-stack tier',
};

/** What the passing tests of a run cover. */
export function coveredItems(
  ledger: Pick<Ledger, 'functions' | 'rows'>
): Set<Item> {
  const covered = new Set<Item>();
  for (const fn of ledger.functions) {
    for (const provider of fn.providers) {
      if (fn.on[provider].covered) covered.add(`${fn.id} ${provider}`);
    }
  }
  for (const row of ledger.rows) {
    if (row.cells.length > 0) covered.add(row.id);
  }
  return covered;
}

/** What a waiver takes out of what must be tested. */
function waivedItems(waivers: readonly Waiver[]): Map<Item, Waiver> {
  const waived = new Map<Item, Waiver>();
  for (const waiver of waivers) {
    const providers: Provider[] =
      waiver.on === 'both' ? ['gmail', 'outlook'] : [];
    if (waiver.on === 'gmail' || waiver.on === 'outlook')
      providers.push(waiver.on);
    if (waiver.on === '-') waived.set(waiver.id, waiver);
    for (const provider of providers)
      waived.set(`${waiver.id} ${provider}`, waiver);
  }
  return waived;
}

export type Enforced = {
  functions: readonly EmailFunction[];
  /** The ids of the manifest's action and state rows. */
  rows: readonly string[];
  proofs: ReadonlyMap<string, string>;
  waivers: readonly Waiver[];
  fullStackOnly: readonly Item[];
  /** What each run that was made covers; a run not made is left out. */
  covered: Partial<Record<GatingRun, ReadonlySet<Item>>>;
  /** The tests kept for known bugs that passed, when that run was made. */
  knownBugsPassing: readonly string[];
};

/** Why the job fails; empty when it does not. */
export function violations(input: Enforced): string[] {
  const found: string[] = [];
  const withUi = input.functions.filter((fn) => fn.ui);
  const all = new Set<Item>([
    ...withUi.flatMap((fn) =>
      fn.providers.map((provider) => `${fn.id} ${provider}`)
    ),
    ...input.rows,
  ]);
  const waived = waivedItems(input.waivers);
  const tier = new Set(input.fullStackOnly);

  // The two lists against the manifest.
  for (const item of waived.keys()) {
    if (!all.has(item))
      found.push(
        `waivers.tsv: ${item} is not a row, or not a function with a UI on that provider`
      );
  }
  for (const item of tier) {
    if (!all.has(item))
      found.push(`full-stack-only.tsv: ${item} is not in the manifest`);
    else if (waived.has(item))
      found.push(`${item} is both waived and in full-stack-only.tsv`);
  }
  const rows = new Set(input.rows);
  for (const id of input.proofs.keys()) {
    if (!id.startsWith('F-') && !rows.has(id))
      found.push(`proofs.tsv: ${id} is not a row of the manifest`);
  }
  for (const fn of withUi) {
    // A function waived on a provider is covered in part at most, and is
    // not counted as proved.
    const whole = fn.providers.every(
      (provider) => !waived.has(`${fn.id} ${provider}`)
    );
    if (whole && !input.proofs.has(fn.id))
      found.push(
        `${fn.id} is not proved: proofs.tsv names no break that makes its tests fail`
      );
  }
  // A row passes with a test only when that test was seen to fail for it.
  for (const id of input.rows) {
    if (!waived.has(id) && !input.proofs.has(id))
      found.push(
        `${id} is not proved: proofs.tsv names no break that makes its test fail at the row's own assertion`
      );
  }

  // Each run that was made against what it is to cover.
  const runs = Object.entries(input.covered) as [
    GatingRun,
    ReadonlySet<Item>,
  ][];
  for (const [run, covered] of runs) {
    for (const item of all) {
      if (waived.has(item)) {
        if (covered.has(item))
          found.push(
            `${item} is waived and a test on ${STACK[run]} covers it: remove it from waivers.tsv`
          );
        continue;
      }
      const mine = tier.has(item) ? 'full-stack' : 'gating';
      if (mine === run && !covered.has(item))
        found.push(
          `${item} has no passing test on ${STACK[run]} and no waiver`
        );
      if (mine === 'full-stack' && run === 'gating' && covered.has(item))
        found.push(
          `${item} is covered on the per-test stack: remove it from full-stack-only.tsv`
        );
    }
  }

  for (const test of input.knownBugsPassing)
    found.push(
      `a test kept for a known bug passes: remove its @known-bug tag and its waiver: ${test}`
    );
  return found;
}

/**
 * What only the full-stack tier covers, as `full-stack-only.tsv` holds it:
 * from a run of both, without what is waived.
 */
export function fullStackOnly(
  covered: Record<GatingRun, ReadonlySet<Item>>,
  waivers: readonly Waiver[]
): string {
  const waived = waivedItems(waivers);
  const lines = [...covered['full-stack']]
    .filter((item) => !covered.gating.has(item) && !waived.has(item))
    .sort()
    .map((item) =>
      item.includes(' ') ? item.replace(' ', '\t') : `${item}\t-`
    );
  return `${['id\ton', ...lines].join('\n')}\n`;
}
