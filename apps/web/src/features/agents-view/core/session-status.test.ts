import { describe, expect, it } from 'vitest';
import { sessionRowStatus } from './session-status';

describe('sessionRowStatus', () => {
  it('reserves waiting state for the section and keeps working above unread', () => {
    expect(sessionRowStatus('waiting', false, false, true)).toBe('unread');
    expect(sessionRowStatus('working', false, true, false)).toBe('working');
    expect(sessionRowStatus('starting', false, false, false)).toBe('working');
  });
  it('keeps failures distinct from unread and idle', () => {
    expect(sessionRowStatus('dormant', true, true, false)).toBe('failed');
    expect(sessionRowStatus('dormant', false, true, false)).toBe('unread');
    expect(sessionRowStatus('dormant', false, false, false)).toBe('idle');
  });
});
