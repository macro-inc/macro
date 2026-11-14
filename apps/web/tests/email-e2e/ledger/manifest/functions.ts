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

/**
 * `../proofs.tsv`: the functions whose tests were shown to catch a
 * regression, each with the break that was put into the product for it.
 */
export function parseProofs(table: string): Map<string, string> {
  const [head, ...lines] = table.split('\n').filter((line) => line !== '');
  if (head !== PROOF_HEAD)
    throw new Error(`proofs.tsv: the head is not ${PROOF_HEAD}`);
  const proofs = new Map<string, string>();
  for (const line of lines) {
    const [id, broke, ...more] = line.split('\t');
    if (!/^F-\d{3}$/.test(id) || !broke || more.length > 0)
      throw new Error(`proofs.tsv: cannot read "${line}"`);
    if (proofs.has(id)) throw new Error(`proofs.tsv: ${id} is listed twice`);
    proofs.set(id, broke);
  }
  return proofs;
}

export const PROOFS: ReadonlyMap<string, string> = parseProofs(
  readFileSync(new URL('../proofs.tsv', import.meta.url), 'utf8')
);
