import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { generate, TEXT_CASES } from './native-corpus';

/** Consumed by the native applier's Rust tests; regenerate with UPDATE_NATIVE_CORPUS=1. */
const FIXTURE = resolve(
  import.meta.dirname,
  '../../../../../crates/client/lexical/macro_document_model/src/plugins_group_c/ai_ops/corpus/text.json'
);

test('the native text-op corpus matches Source Doc', () => {
  const entries = generate(TEXT_CASES);
  // Every case exercises a real outcome: an applied change or a recorded failure.
  for (const entry of entries)
    expect(
      entry.failedAt !== null ||
        JSON.stringify(entry.state) !== JSON.stringify(entry.seed),
      entry.name
    ).toBe(true);
  const json = `${JSON.stringify(entries, null, 2)}\n`;
  if (process.env.UPDATE_NATIVE_CORPUS === '1') writeFileSync(FIXTURE, json);
  expect(existsSync(FIXTURE)).toBe(true);
  expect(readFileSync(FIXTURE, 'utf8')).toBe(json);
});
