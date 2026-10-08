import { describe, expect, it } from 'vitest';
import { restoreOnboardingStep } from './steps';

describe('onboarding resume', () => {
  it.each([
    ['email', 'work'],
    ['connect-linear', 'tools'],
    ['building', 'plan'],
    ['summary', 'plan'],
    ['personal', 'personal'],
    ['team', 'team'],
  ])('migrates %s to %s', (saved, expected) => {
    expect(restoreOnboardingStep(saved)).toBe(expected);
  });
  it.each([undefined, null, {}, 17, 'unknown'])(
    'starts safely for invalid saved steps',
    (saved) => {
      expect(restoreOnboardingStep(saved)).toBe('welcome');
    }
  );
  it('restores the checkout step even when session storage was lost', () => {
    expect(restoreOnboardingStep(undefined, true)).toBe('plan');
    expect(restoreOnboardingStep('work', true)).toBe('plan');
  });
});
