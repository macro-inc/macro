import { describe, expect, it } from 'vitest';
import {
  nextSignupStep,
  parseSignupDraft,
  previousSignupStep,
  serializeSignupDraft,
} from './signup-draft';

describe('parseSignupDraft', () => {
  it.each([
    [null, undefined],
    ['not json', undefined],
    ['{"step":"plan"}', undefined],
    ['[]', undefined],
    ['{"step":"vision"}', { step: 'vision', authenticating: false }],
    [
      '{"step":"work","accent":"#65d8ac","authenticating":true}',
      { step: 'work', accent: '#65d8ac', authenticating: true },
    ],
    [
      '{"step":"vision","accent":"red","authenticating":true}',
      { step: 'vision', authenticating: false },
    ],
  ])('%s → %o', (raw, expected) => {
    expect(parseSignupDraft(raw)).toEqual(expected);
  });

  it('round-trips a serialized draft', () => {
    const draft = {
      step: 'work',
      accent: '#7abde5',
      authenticating: true,
    } as const;
    expect(parseSignupDraft(serializeSignupDraft(draft))).toEqual(draft);
  });
});

describe('signup step order', () => {
  it('walks welcome → vision → security → work', () => {
    expect(nextSignupStep('welcome')).toBe('vision');
    expect(nextSignupStep('security')).toBe('work');
    expect(nextSignupStep('work')).toBe('work');
    expect(previousSignupStep('work')).toBe('security');
    expect(previousSignupStep('welcome')).toBeUndefined();
  });
});
