import type { Chapter, ReviewFile, ReviewThread } from '../core/model';
import snapshot from './diffd-fixture.json';

/** Real difftastic alignment and tree-sitter syntax from diffd's demo. */
export const files: ReviewFile[] = snapshot.map((file) => ({
  ...file,
  rows: file.rows.map(([old, next]) => [old, next]),
}));

export const chapters: Chapter[] = [
  {
    title: 'Allow a bounded burst',
    description:
      'Give short bursts a little headroom, while keeping the sustained rate exactly where it was.',
    paths: ['src/lib.rs', 'src/bucket.rs', 'db/schema.sql'],
    focus: { path: 'src/lib.rs', side: 'new', line: 45 },
    note: 'The clock is passed into acquire so tests can advance time deterministically. The result now tells the caller how long to wait instead of returning false.',
  },
  {
    title: 'Make retry behavior explicit',
    description:
      'Turn an exhausted quota into a useful retry time. Callers can back off without guessing.',
    paths: ['src/routes.rs', 'cmd/probe/main.go'],
    focus: { path: 'cmd/probe/main.go', side: 'new', line: 11 },
    note: 'The probe now has a bounded timeout and reports Retry-After. Closing the body keeps repeated probes from holding connections open.',
  },
  {
    title: 'Explain the limit to the user',
    description:
      'Carry the typed rate-limit error through to the badge, with a clear message about when to try again.',
    paths: ['web/src/api.ts', 'web/src/QuotaBadge.tsx', 'web/src/badge.css'],
    focus: { path: 'web/src/api.ts', side: 'new', line: 7 },
    note: 'A distinct rate-limit error lets the UI distinguish a quota from a network failure. The badge can show a useful wait time.',
  },
  {
    title: 'Cover recovery and the edges',
    description:
      'Exercise burst exhaustion, refill, and the client error path before connecting the remaining generated changes.',
    paths: ['tests/limiter.rs', 'web/src/api.test.ts', 'README.md'],
    focus: { path: 'tests/limiter.rs', side: 'new', line: 7 },
    note: 'These tests advance the clock instead of sleeping, so recovery behavior stays deterministic in CI.',
  },
];

export const initialThreads: ReviewThread[] = [
  {
    id: 'burst-capacity',
    location: { path: 'src/lib.rs', side: 'new', line: 54 },
    resolved: false,
    messages: [
      {
        id: 'question',
        author: 'You',
        body: 'Does the burst recover after the limiter has been idle?',
      },
      {
        id: 'answer',
        author: 'Agent',
        body: 'Yes. Refill caps at capacity + burst, so an idle limiter recovers its full allowance. The injected clock lets us exercise that without sleeping.',
      },
    ],
  },
];

/** A deliberate rendering stress fixture, not a claimed production benchmark. */
export function hugeFile(): ReviewFile {
  const count = 100_000;
  const before = Array.from(
    { length: count },
    (_, i) => `export const limit_${i + 1} = { capacity: 10, burst: 0 };`
  );
  const after = before.map((line) => line.replace('burst: 0', 'burst: 5'));
  const novelty = before.map((line) => [line.length - 4, line.length - 3]);
  return {
    path: 'fixtures/large-review.ts',
    language: 'TypeScript',
    status: 'modified',
    added: count,
    removed: count,
    collapsed: null,
    labels: [],
    old: { lines: before, syntax: [], novel: novelty },
    new: { lines: after, syntax: [], novel: novelty },
    rows: before.map((_, index) => [index, index]),
  };
}
