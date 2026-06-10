import { defineBlock, type ExtractLoadType, LoadErrors } from '@core/block';
import { ok } from 'neverthrow';

import { CompanyBlockAdapter } from './component/CompanyBlockAdapter';

export const definition = defineBlock({
  name: 'company',
  description: 'View a CRM company',
  component: CompanyBlockAdapter,
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
