import { defineBlock, type ExtractLoadType, LoadErrors } from '@core/block';
import { lazy } from '@core/util/lazy';
import { ok } from 'neverthrow';

export const definition = defineBlock({
  name: 'company',
  description: 'View a CRM company',
  component: lazy(async () => ({
    default: (await import('./component/CompanyBlockAdapter'))
      .CompanyBlockAdapter,
  })),
  liveTrackingEnabled: false,
  async load(source, _intent) {
    if (source.type === 'dss') {
      return ok({ id: source.id });
    }
    return LoadErrors.MISSING;
  },
  accepted: {},
});

export type CompanyData = ExtractLoadType<(typeof definition)['load']>;
