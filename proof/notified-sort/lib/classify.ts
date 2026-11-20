// Every raw difference is kept. A difference whose two values are the same
// instant written two ways (`...Z` from REST, `...+00:00` from GraphQL) is
// tagged `same-instant`; every other difference keeps its own signature and
// has to be closed in the report (cause, plus caller-level evidence or a fix).

import type { Difference } from './compare.ts';

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export function sameInstant(a: unknown, b: unknown): boolean {
  return (
    typeof a === 'string' &&
    typeof b === 'string' &&
    ISO.test(a) &&
    ISO.test(b) &&
    Date.parse(a) === Date.parse(b) &&
    // Date.parse drops digits past milliseconds; compare those too.
    (a.match(/\.(\d+)/)?.[1] ?? '').padEnd(9, '0') === (b.match(/\.(\d+)/)?.[1] ?? '').padEnd(9, '0')
  );
}

export type Classified = Difference & { cls: string };

export function classify(diff: Difference): Classified {
  if (diff.kind === 'field' && sameInstant(diff.old, diff.new)) {
    return { ...diff, cls: `same-instant:${diff.signature}` };
  }
  return { ...diff, cls: diff.signature };
}

/** Counts per class, with one example each. */
export function tally(diffs: Classified[], into = new Map<string, { n: number; example: Classified }>()) {
  for (const diff of diffs) {
    const entry = into.get(diff.cls);
    if (entry) entry.n += 1;
    else into.set(diff.cls, { n: 1, example: diff });
  }
  return into;
}
