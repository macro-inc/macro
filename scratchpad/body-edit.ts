import { readFileSync, writeFileSync } from 'node:fs';
const [src, dst] = process.argv.slice(2);
let t = readFileSync(src, 'utf8');
const steps: [string, string][] = [
  [
    `    start resends what a page that is gone left noted. The queue's Web
    Lock lease is released when its page is gone (\`mutation-queue-*\`), so
    the next page drains at once instead of waiting out the lease.
`,
    `    start resends what a page that is gone left noted. The queue lease
    such a page left on the head is released by the page-owner locks
    already on main (\`mutation-queue-owner.ts\`).
`,
  ],
  [
    `    code and has not been seen in the suite. The queue releases a lease
    it holds without an attempt under it (\`lease-unrouted\`).
  - A checkout that already had a cache engine kept it: the engine is
    rebuilt only when the \`cache-wasm\` version changes, and the lease
    fields were added to inspections without a new version. With the old
    engine the release of a gone page's lease finds no owner to check,
    and a write behind that lease waits five minutes. The version is
    now 0.6.55.
`,
    `    code and has not been seen in the suite. After an enqueue loses its
    answer, the queue releases a lease this page took and sends nothing
    under (\`releaseUnroutedLease\`, \`lease-unrouted\`); it looks at the
    queue for this only then, since an inspection reads the whole queue.
`,
  ],
];
for (const [a, b] of steps) {
  if (!t.includes(a)) throw new Error('no match: ' + a.slice(0, 40));
  t = t.replace(a, b);
}
writeFileSync(dst, t);
