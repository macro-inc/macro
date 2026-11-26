// The functions of email: what a user does with it, one row each, in
// `../functions.tsv`. The backend's coverage maps its entry points to the
// same ids, so the list is a plain table and not TypeScript.

import { readFileSync } from 'node:fs';
import type { Provider } from './types';

export type EmailFunction = {
  /** `F-012`. Stable: never renumbered, never reused. */
  id: string;
  area: string;
  name: string;
  providers: readonly Provider[];
  /** Whether a user can do it in the web app; the others are the backend's alone. */
  ui: boolean;
  /**
   * Where its effect is checked besides the screen: at the provider, in the
   * service when the provider sees nothing of it, or only in the UI.
   */
  checkedAt: 'provider' | 'service' | 'ui';
};

const HEAD = 'id\tarea\tfunction\tgmail\toutlook\tui\tresult_checked_at';

export function parseFunctions(table: string): EmailFunction[] {
  const [head, ...lines] = table.split('\n').filter((line) => line !== '');
  if (head !== HEAD) throw new Error(`functions.tsv: the head is not ${HEAD}`);
  return lines.map((line) => {
    const cells = line.split('\t');
    const [id, area, name, gmail, outlook, ui, checkedAt] = cells;
    const yes = (cell: string) => {
      if (cell !== 'yes' && cell !== 'no')
        throw new Error(`functions.tsv: ${id}: ${cell} is not yes or no`);
      return cell === 'yes';
    };
    if (cells.length !== 7 || !/^F-\d{3}$/.test(id) || !area || !name)
      throw new Error(`functions.tsv: cannot read "${line}"`);
    if (
      checkedAt !== 'provider' &&
      checkedAt !== 'service' &&
      checkedAt !== 'ui'
    )
      throw new Error(`functions.tsv: ${id}: checked at ${checkedAt}?`);
    const providers: Provider[] = [];
    if (yes(gmail)) providers.push('gmail');
    if (yes(outlook)) providers.push('outlook');
    if (providers.length === 0)
      throw new Error(`functions.tsv: ${id}: on no provider`);
    return { id, area, name, providers, ui: yes(ui), checkedAt };
  });
}

export const FUNCTIONS: readonly EmailFunction[] = parseFunctions(
  readFileSync(new URL('../functions.tsv', import.meta.url), 'utf8')
);

const PROOF_HEAD = 'id\tbreak';
const PROOF_ID = /^(F-\d{3}|(AL|AC|AX|STL|STC|STX)-\d+)$/;

/**
 * `../proofs.tsv`: the functions whose tests were shown to catch a
 * regression, each with the break that was put into the product for it,
 * and the rows (a way into a function) shown the same way.
 */
export function parseProofs(table: string): Map<string, string> {
  const [head, ...lines] = table.split('\n').filter((line) => line !== '');
  if (head !== PROOF_HEAD)
    throw new Error(`proofs.tsv: the head is not ${PROOF_HEAD}`);
  const proofs = new Map<string, string>();
  for (const line of lines) {
    const [id, broke, ...more] = line.split('\t');
    if (!PROOF_ID.test(id) || !broke || more.length > 0)
      throw new Error(`proofs.tsv: cannot read "${line}"`);
    if (proofs.has(id)) throw new Error(`proofs.tsv: ${id} is listed twice`);
    proofs.set(id, broke);
  }
  return proofs;
}

export const PROOFS: ReadonlyMap<string, string> = parseProofs(
  readFileSync(new URL('../proofs.tsv', import.meta.url), 'utf8')
);

/** Why something has no passing test and the job still passes. */
export type Waiver = {
  /** A function (`F-012`) or a row (`AL-012`). */
  id: string;
  /** The providers a function is waived on; `-` for a row. */
  on: 'gmail' | 'outlook' | 'both' | '-';
  kind:
    | 'bug' // a product bug keeps it from working; a known-bug test waits
    | 'needs' // needs something no stack of the suite has
    | 'native-only' // exists only in the desktop or mobile app
    | 'no-user-path' // code no user can reach
    | 'backlog'; // could be tested here and is not yet
  reason: string;
};

const WAIVER_HEAD = 'id\ton\tkind\treason';
const WAIVER_KINDS = ['bug', 'needs', 'native-only', 'no-user-path', 'backlog'];

/**
 * `../waivers.tsv`: every function and row that has no passing test, each
 * with the reason. The one place they are kept, so a review sees each.
 */
export function parseWaivers(table: string): Waiver[] {
  const [head, ...lines] = table.split('\n').filter((line) => line !== '');
  if (head !== WAIVER_HEAD)
    throw new Error(`waivers.tsv: the head is not ${WAIVER_HEAD}`);
  const seen = new Set<string>();
  return lines.map((line) => {
    const [id, on, kind, reason, ...more] = line.split('\t');
    const isFunction = /^F-\d{3}$/.test(id);
    const onFits = isFunction
      ? on === 'gmail' || on === 'outlook' || on === 'both'
      : on === '-';
    if (!id || !onFits || !WAIVER_KINDS.includes(kind) || !reason?.trim())
      throw new Error(`waivers.tsv: cannot read "${line}"`);
    if (more.length > 0) throw new Error(`waivers.tsv: too much in "${line}"`);
    if (seen.has(id)) throw new Error(`waivers.tsv: ${id} is listed twice`);
    seen.add(id);
    return { id, on, kind, reason } as Waiver;
  });
}

export const WAIVERS: readonly Waiver[] = parseWaivers(
  readFileSync(new URL('../waivers.tsv', import.meta.url), 'utf8')
);

const FULL_STACK_ONLY_HEAD = 'id\ton';

/**
 * `../full-stack-only.tsv`: what only the full-stack tier's tests cover, a
 * function on a provider (`F-050 gmail`) or a row (`AL-012 -`). Everything
 * else that is not waived is the per-test stack's. Written by
 * `report.ts --record` from a run of both.
 */
export function parseFullStackOnly(table: string): string[] {
  const [head, ...lines] = table.split('\n').filter((line) => line !== '');
  if (head !== FULL_STACK_ONLY_HEAD)
    throw new Error(
      `full-stack-only.tsv: the head is not ${FULL_STACK_ONLY_HEAD}`
    );
  return lines.map((line, index) => {
    const [id, on, ...more] = line.split('\t');
    const fits = /^F-\d{3}$/.test(id)
      ? on === 'gmail' || on === 'outlook'
      : on === '-';
    if (!id || !fits || more.length > 0)
      throw new Error(`full-stack-only.tsv: cannot read "${line}"`);
    if (lines.indexOf(line) !== index)
      throw new Error(`full-stack-only.tsv: "${line}" is there twice`);
    return on === '-' ? id : `${id} ${on}`;
  });
}

export const FULL_STACK_ONLY: readonly string[] = parseFullStackOnly(
  readFileSync(new URL('../full-stack-only.tsv', import.meta.url), 'utf8')
);

const LIMIT_HEAD = 'id\tlimit';

/**
 * `../limits.tsv`: what the tests of a covered function do not prove, said
 * in the report beside it.
 */
export function parseLimits(table: string): Map<string, string> {
  const [head, ...lines] = table.split('\n').filter((line) => line !== '');
  if (head !== LIMIT_HEAD)
    throw new Error(`limits.tsv: the head is not ${LIMIT_HEAD}`);
  const limits = new Map<string, string>();
  for (const line of lines) {
    const [id, limit, ...more] = line.split('\t');
    if (!/^F-\d{3}$/.test(id) || !limit || more.length > 0)
      throw new Error(`limits.tsv: cannot read "${line}"`);
    if (limits.has(id)) throw new Error(`limits.tsv: ${id} is there twice`);
    limits.set(id, limit);
  }
  return limits;
}

export const LIMITS: ReadonlyMap<string, string> = parseLimits(
  readFileSync(new URL('../limits.tsv', import.meta.url), 'utf8')
);
