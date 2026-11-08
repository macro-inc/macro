// Run the service's actual assertions while recording all twelve input pairs.
import { afterAll } from 'bun:test';
import { plugin } from 'bun';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const pairs: unknown[] = [];
Object.assign(globalThis, { captureGatePair: (before: unknown, after: unknown) => pairs.push(structuredClone({ before, after })) });
plugin({ name: 'capture-gate-seeds', setup(builder) {
  builder.onLoad({ filter: /\/lib\/comment-only-change\.ts$/ }, ({ path }) => ({
    contents: readFileSync(path, 'utf8').replace('export function isCommentOnlyChange(', 'function sourceIsCommentOnlyChange(') + '\nexport function isCommentOnlyChange(before, after) { globalThis.captureGatePair(before, after); return sourceIsCommentOnlyChange(before, after); }',
    loader: 'ts',
  }));
}});
await import(root + 'services/lexical-service/src/lib/comment-only-change.test.ts');
afterAll(() => {
  if (pairs.length !== 12) throw new Error(`Expected 12 service seeds, received ${pairs.length}`);
  const output = process.env.GATE_SEED_OUTPUT;
  if (!output) throw new Error('GATE_SEED_OUTPUT is required');
  writeFileSync(output, JSON.stringify(pairs));
});
