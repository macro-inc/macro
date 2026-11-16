import { expect, test } from 'vitest';
import { compare } from '../scripts/normalize-transcripts.mjs';

const expected = process.env.SYNC_TRANSCRIPT_EXPECTED;
const actual = process.env.SYNC_TRANSCRIPT_ACTUAL;
test.skipIf(!expected || !actual)('recorded transcripts match the baseline', () => {
  expect(compare(expected!, actual!)).toEqual([]);
}, 60_000);
