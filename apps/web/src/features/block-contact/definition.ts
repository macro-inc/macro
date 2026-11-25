import { defineBlock, type ExtractLoadType, LoadErrors } from '@core/block';
import { lazy } from '@core/util/lazy';
import { ok } from 'neverthrow';

export const definition = defineBlock({
  name: 'contact',
  description: 'View a CRM contact',
  component: lazy(async () => ({
    default: (await import('./component/ContactBlockAdapter'))
      .ContactBlockAdapter,
  })),
  liveTrackingEnabled: false,
  // The id a block opens with can name a contact merged into another, so the
  // contact view records the open under the id its read answers with.
  openTrackingEnabled: false,
  openAnalyticsEnabled: true,
  async load(source, _intent) {
    if (source.type === 'dss') {
      return ok({ id: source.id });
    }
    return LoadErrors.MISSING;
  },
  accepted: {},
});

export type ContactData = ExtractLoadType<(typeof definition)['load']>;
