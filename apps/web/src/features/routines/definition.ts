import { defineBlock, type ExtractLoadType, LoadErrors } from '@core/block';
import { ok } from 'neverthrow';

import { Routine } from './routine-detail';

export const definition = defineBlock({
  name: 'routine',
  description: 'view and edit a single routine',
  defaultFilename: 'Untitled routine',
  component: Routine,
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

export type RoutineData = ExtractLoadType<(typeof definition)['load']>;
