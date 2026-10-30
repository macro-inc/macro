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

  it('opens a valid step link when nothing is saved', () => {
    expect(restoreOnboardingStep(undefined, false, 'plan')).toBe('plan');
    expect(restoreOnboardingStep(undefined, false, 'work')).toBe('work');
  });

  it('ignores an unknown step link', () => {
    expect(restoreOnboardingStep(undefined, false, 'nope')).toBe('welcome');
    expect(restoreOnboardingStep(undefined, false, 'email')).toBe('welcome');
    expect(restoreOnboardingStep(undefined, false, 'building')).toBe('welcome');
  });

  it('prefers saved progress over the step link', () => {
    expect(restoreOnboardingStep('team', false, 'plan')).toBe('team');
    expect(restoreOnboardingStep('email', false, 'plan')).toBe('work');
  });

  it('lets a checkout return beat saved progress and the step link', () => {
    expect(restoreOnboardingStep('work', true, 'team')).toBe('plan');
    expect(restoreOnboardingStep(undefined, true, 'welcome')).toBe('plan');
  });
});
