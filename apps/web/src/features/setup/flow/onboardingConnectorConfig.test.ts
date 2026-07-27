import { describe, expect, it } from 'vitest';
import {
  ONBOARDING_CONNECTORS,
  resolveOnboardingConnectorNames,
  resolveOnboardingStepIndex,
} from './onboardingConnectorConfig';

const allConnectors = ONBOARDING_CONNECTORS.map(({ serverName }) => serverName);

describe('resolveOnboardingConnectorNames', () => {
  it('shows every connector when the feature flag is disabled', () => {
    expect(
      resolveOnboardingConnectorNames(false, {
        linear: false,
        notion: false,
        slack: false,
        github: false,
      })
    ).toEqual(allConnectors);
  });

  it('hides connectors explicitly disabled in the payload', () => {
    expect(
      resolveOnboardingConnectorNames(true, {
        linear: false,
        slack: false,
      })
    ).toEqual(['Notion', 'GitHub']);
  });

  it('can hide every connector', () => {
    expect(
      resolveOnboardingConnectorNames(true, {
        linear: false,
        notion: false,
        slack: false,
        github: false,
      })
    ).toEqual([]);
  });

  it('keeps connectors visible for missing or invalid values', () => {
    expect(
      resolveOnboardingConnectorNames(true, {
        linear: 'false',
        notion: null,
        slack: 0,
      })
    ).toEqual(allConnectors);
  });

  it('shows every connector for malformed payloads', () => {
    for (const payload of [undefined, null, [], 'invalid']) {
      expect(resolveOnboardingConnectorNames(true, payload)).toEqual(
        allConnectors
      );
    }
  });
});

describe('resolveOnboardingStepIndex', () => {
  const fullStepList = [
    'email',
    'connect-linear',
    'connect-notion',
    'connect-slack',
    'connect-github',
    'team',
    'building',
    'summary',
    'plan',
  ];

  it('preserves the active step when an earlier connector is hidden', () => {
    const reducedStepList = fullStepList.filter(
      (key) => key !== 'connect-notion'
    );

    expect(resolveOnboardingStepIndex(fullStepList, 'connect-slack')).toBe(3);
    expect(resolveOnboardingStepIndex(reducedStepList, 'connect-slack')).toBe(
      2
    );
  });

  it('falls forward when the active connector is hidden', () => {
    const reducedStepList = fullStepList.filter(
      (key) => key !== 'connect-notion'
    );

    expect(resolveOnboardingStepIndex(reducedStepList, 'connect-notion')).toBe(
      2
    );
    expect(reducedStepList[2]).toBe('connect-slack');
  });

  it('stays in bounds when several connectors disappear', () => {
    const reducedStepList = ['email', 'team', 'building', 'summary', 'plan'];
    const index = resolveOnboardingStepIndex(reducedStepList, 'connect-github');

    expect(index).toBe(1);
    expect(reducedStepList[index]).toBe('team');
  });

  it('falls back safely for an unknown saved step', () => {
    expect(resolveOnboardingStepIndex(fullStepList, 'unknown')).toBe(0);
  });
});
