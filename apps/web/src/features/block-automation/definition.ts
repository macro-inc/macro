import { defineBlock, type ExtractLoadType, LoadErrors } from '@core/block';
import { ok } from 'neverthrow';
import { lazy } from 'solid-js';

export const definition = defineBlock({
  name: 'automation',
  description: 'view and edit a single automation',
  defaultFilename: 'Untitled automation',
  component: lazy(() =>
    import('./component/Automation').then((module) => ({
      default: module.Automation,
    }))
  ),
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
