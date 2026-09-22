import { describe, expect, it } from 'vitest';
import { parseWorkerEvent } from './protocol';

const encode = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value));
describe('voice worker status boundary', () => {
  it('accepts only supported versioned media status events', () => {
    expect(parseWorkerEvent(encode({ version: 1, type: 'ready' }))).toEqual({
      type: 'ready',
    });
    expect(
      parseWorkerEvent(
        encode({ version: 1, type: 'error', message: 'Connection failed' })
      )
    ).toEqual({ type: 'error', message: 'Connection failed' });
    expect(parseWorkerEvent(encode({ version: 1, type: 'ended' }))).toEqual({
      type: 'ended',
    });
    expect(
      parseWorkerEvent(encode({ version: 2, type: 'ready' }))
    ).toBeUndefined();
    expect(
      parseWorkerEvent(encode({ version: 1, type: 'ask_macro' }))
    ).toBeUndefined();
  });
  it('ignores malformed, primitive and oversized UTF-8 packets', () => {
    expect(parseWorkerEvent(new TextEncoder().encode('{'))).toBeUndefined();
    expect(parseWorkerEvent(encode(null))).toBeUndefined();
    expect(parseWorkerEvent(encode('ready'))).toBeUndefined();
    expect(
      parseWorkerEvent(
        encode({ version: 1, type: 'error', message: '界'.repeat(6000) })
      )
    ).toBeUndefined();
  });
  it('bounds human-readable errors', () => {
    expect(
      parseWorkerEvent(
        encode({ version: 1, type: 'error', message: 'x'.repeat(1000) })
      )?.message
    ).toHaveLength(500);
  });
});
