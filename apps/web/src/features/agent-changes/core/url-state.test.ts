import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DIFF_URL_STATE,
  readDiffUrlState,
  writeDiffUrlState,
} from './url-state';

describe('diff URL identities', () => {
  it('round-trips namespaced PR ids and preserves adjacent sessions', () => {
    const key = 'pr:macro-inc/macro/1482,revision%2';
    const state = { layout: 'changes-only', diffStyle: 'split' } as const;
    const value = writeDiffUrlState('session-1:split:unified', key, state);
    expect(readDiffUrlState(value, key)).toEqual(state);
    expect(readDiffUrlState(value, 'session-1')).toEqual({
      layout: 'split',
      diffStyle: 'unified',
    });
    expect(writeDiffUrlState(value, key, DEFAULT_DIFF_URL_STATE)).toBe(
      'session-1:split:unified'
    );
  });

  it('ignores malformed escaping', () => {
    expect(readDiffUrlState('%xx:split:unified', '%xx')).toEqual(
      DEFAULT_DIFF_URL_STATE
    );
  });
});
