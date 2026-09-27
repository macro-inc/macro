import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DIFF_URL_STATE,
  readDiffUrlState,
  removeDiffUrlState,
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

  it('removes one entry and leaves a value without it untouched', () => {
    const value = 'pr%3A1:split:unified,session-1:changes-only:split';
    expect(removeDiffUrlState(value, 'pr:1')).toBe(
      'session-1:changes-only:split'
    );
    expect(removeDiffUrlState('pr%3A1:split:unified', 'pr:1')).toBeUndefined();
    expect(removeDiffUrlState(value, 'session-2')).toBe(value);
    expect(removeDiffUrlState(undefined, 'session-2')).toBeUndefined();
  });

  it('ignores malformed escaping', () => {
    expect(readDiffUrlState('%xx:split:unified', '%xx')).toEqual(
      DEFAULT_DIFF_URL_STATE
    );
  });
});
