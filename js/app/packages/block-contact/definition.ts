import { defineBlock, type ExtractLoadType, LoadErrors } from '@core/block';
import { ok } from 'neverthrow';
import { lazy } from 'solid-js';

export const definition = defineBlock({
  name: 'contact',
  description: 'View a CRM contact',
  component: lazy(() =>
    import('./component/ContactBlockAdapter').then((module) => ({
      default: module.ContactBlockAdapter,
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

export type ContactData = ExtractLoadType<(typeof definition)['load']>;
