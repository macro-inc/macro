import { describe, expect, it } from 'vitest';
import {
  ONBOARDING_CONNECTORS,
  resolveOnboardingConnectorNames,
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

  it.each([
    undefined,
    null,
    [],
    'invalid',
  ])('shows every connector for a malformed payload: %s', (payload) => {
    expect(resolveOnboardingConnectorNames(true, payload)).toEqual(
      allConnectors
    );
  });
});
