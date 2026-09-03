import { defineBlock, type ExtractLoadType, LoadErrors } from '@core/block';
import { ok } from 'neverthrow';
import { lazy } from 'solid-js';

export const definition = defineBlock({
  name: 'company',
  description: 'View a CRM company',
  component: lazy(() =>
    import('./component/CompanyBlockAdapter').then((module) => ({
      default: module.CompanyBlockAdapter,
    }))
  ),
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
