import { defineBlock, LoadErrors } from '@core/block';
import { lazy } from '@core/util/lazy';
import { ok } from 'neverthrow';

/** A CRM pipeline, which opens in the Customers view. */
export const definition = defineBlock({
  name: 'pipeline',
  description: 'View a CRM pipeline',
  component: lazy(() => import('./component/PipelineBlock')),
  liveTrackingEnabled: false,
  async load(source, _intent) {
    if (source.type === 'dss') {
      return ok({ id: source.id });
    }
    return LoadErrors.MISSING;
  },
  accepted: {},
});
