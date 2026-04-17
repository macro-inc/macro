import { defineBlock, type ExtractLoadType, LoadErrors } from '@core/block';
import { ok } from '@core/util/maybeResult';
import { Automation } from './component/Automation';

export const definition = defineBlock({
  name: 'automation',
  description: 'view and edit a single automation',
  defaultFilename: 'Automation',
  component: Automation,
  accepted: {},
  async load(source, intent) {
    if (source.type === 'dss') {
      if (intent === 'preload') {
        return ok({
          type: 'preload',
          origin: source,
        });
      }
      return ok({ scheduleId: source.id });
    }
    return LoadErrors.INVALID;
  },
  liveTrackingEnabled: false,
});

export type AutomationData = ExtractLoadType<(typeof definition)['load']>;
