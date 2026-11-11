import { expect, it } from 'vitest';
import { createReplaceableReader } from './create-replaceable-reader';

it('releases completed job signals without aborting their caller or the next read', async () => {
  const observed: AbortSignal[] = [];
  const reader = createReplaceableReader(async (value: number, signal) => {
    expect(signal.aborted).toBe(false);
    observed.push(signal);
    return value;
  });
  const caller = new AbortController();
  expect(await reader.read(1, caller.signal)).toBe(1);
  expect(observed[0].aborted).toBe(true);
  expect(caller.signal.aborted).toBe(false);
  expect(await reader.read(2, caller.signal)).toBe(2);
  expect(observed[1].aborted).toBe(true);
  expect(caller.signal.aborted).toBe(false);
  reader.dispose();
});
