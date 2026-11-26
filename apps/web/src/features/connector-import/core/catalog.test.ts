import { enableAttioImport } from '@core/constant/featureFlags';
import { describe, expect, it } from 'vitest';
import { IMPORT_CATEGORIES, importSourceFor, offeredCategory } from './catalog';

const crm = IMPORT_CATEGORIES.crm;
const flagged = (override: boolean) => ({
  ...crm,
  providers: crm.providers.map((provider) =>
    provider.appSlug === 'hubspot'
      ? { ...provider, flag: { key: 'enable-example-import', override } }
      : provider
  ),
});
const slugs = (config: typeof crm) =>
  offeredCategory(config).providers.map((provider) => provider.appSlug);

describe('offered import providers', () => {
  it('offers every row that waits on no flag', () => {
    for (const config of Object.values(IMPORT_CATEGORIES)) {
      expect(slugs(config)).toEqual(
        config.providers
          .filter((provider) => !provider.flag)
          .map((provider) => provider.appSlug)
      );
    }
  });

  it('hides a flagged row while its flag is off and offers it once on', () => {
    expect(slugs(flagged(false))).not.toContain('hubspot');
    expect(slugs(flagged(true))).toContain('hubspot');
    expect(slugs(flagged(false))).toContain('salesforce_rest_api');
  });

  it('hides Attio while its rollout flag is off', () => {
    // No env override and no PostHog answer: the flag reads off.
    expect(enableAttioImport.override).toBeUndefined();

    expect(slugs(crm)).not.toContain('attio');
    expect(importSourceFor('attio')).toBeUndefined();
    expect(importSourceFor('hubspot')?.provider.name).toBe('HubSpot');
  });
});
