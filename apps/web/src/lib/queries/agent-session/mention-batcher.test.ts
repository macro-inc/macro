import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgentSessionMentionBatcher } from './mention-batcher';

afterEach(() => vi.useRealTimers());

describe('agent session preview batching', () => {
  it('deduplicates concurrent lookups and preserves access results', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(
      async () =>
        new Map([
          ['one', { access: 'no_access' as const }],
          ['two', { access: 'does_not_exist' as const }],
        ])
    );
    const load = createAgentSessionMentionBatcher(fetch);
    const results = Promise.all([load('one'), load('two'), load('one')]);
    await vi.advanceTimersByTimeAsync(35);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(['one', 'two']);
    expect(await results).toEqual([
      { access: 'no_access' },
      { access: 'does_not_exist' },
      { access: 'no_access' },
    ]);
  });
  it('does not misrepresent missing batch results as deletion', async () => {
    vi.useFakeTimers();
    const load = createAgentSessionMentionBatcher(async () => new Map());
    const assertion = expect(load('missing')).rejects.toThrow(
      'Missing agent session preview'
    );
    await vi.advanceTimersByTimeAsync(35);
    await assertion;
  });
});
