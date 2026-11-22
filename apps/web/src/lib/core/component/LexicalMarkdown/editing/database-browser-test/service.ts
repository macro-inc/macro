export * from '../../../../../queries/storage/databases';

import { err, ok } from 'neverthrow';

let finish: (() => void) | undefined;
export async function createDatabase(input: { name: string; source: string }) {
  const log = document.getElementById('service');
  if (!log) throw new Error('Missing service facts');
  log.textContent = JSON.stringify(input);
  await new Promise<void>((resolve) => {
    finish = resolve;
  });
  return new URLSearchParams(location.search).has('fail')
    ? err('fixture-create-failure')
    : ok('fixture-database');
}
export function complete() {
  finish?.();
}
