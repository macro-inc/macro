import { errAsync, okAsync } from 'neverthrow';
import { describe, expect, it } from 'vitest';
import { traced } from './traced';

describe('traced', () => {
  it('returns what the operation returned, success or failure', async () => {
    const sent = await traced('contracts.test', { 'packet.id': 'p1' }, () =>
      okAsync<string, { kind: 'not_found' }>('sent')
    );
    expect(sent._unsafeUnwrap()).toBe('sent');

    const missing = await traced('contracts.test', {}, () =>
      errAsync<string, { kind: 'not_found' }>({ kind: 'not_found' })
    );
    expect(missing._unsafeUnwrapErr()).toEqual({ kind: 'not_found' });
  });

  it('runs the operation once', async () => {
    let runs = 0;
    await traced('contracts.test', {}, () => {
      runs += 1;
      return okAsync<number, { kind: 'not_found' }>(runs);
    });
    expect(runs).toBe(1);
  });
});
