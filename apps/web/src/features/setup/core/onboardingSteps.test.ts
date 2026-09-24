import { describe, expect, it } from 'vitest';
import { onboardingStepKeys, resolveSetupStep } from './onboardingSteps';

describe('onboarding journey', () => {
  it('puts security and required account before selection, one step per tool then team', () => {
    expect(onboardingStepKeys(['notion', 'github', 'figma'])).toEqual([
      'welcome',
      'vision',
      'security',
      'email',
      'personal',
      'tools',
      'connect-notion',
      'connect-github',
      'connect-figma',
      'plan',
      'team',
    ]);
  });
  it('can skip integration setup without adding connection steps', () => {
    expect(onboardingStepKeys([])).toEqual([
      'welcome',
      'vision',
      'security',
      'email',
      'personal',
      'tools',
      'plan',
      'team',
    ]);
  });
  it('restores selected providers and migrates removed screens', () => {
    const keys = onboardingStepKeys(['notion']);
    expect(resolveSetupStep(keys, 'connect-notion')).toBe('connect-notion');
    expect(resolveSetupStep(keys, 'connect-slack')).toBe('tools');
    expect(resolveSetupStep(keys, 'vision')).toBe('vision');
    expect(resolveSetupStep(keys, 'customize')).toBe('team');
    expect(resolveSetupStep(keys, 'summary')).toBe('plan');
  });
});
