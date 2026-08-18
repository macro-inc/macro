import { defineBlock, type ExtractLoadType, LoadErrors } from '@core/block';
import { ok } from 'neverthrow';
import { lazy } from 'solid-js';
import { CALENDAR_BLOCK_ID } from './types';

export const definition = defineBlock({
  name: 'calendar',
  description: 'View calendar events',
  component: lazy(() => import('./CalendarBlockAdapter')),
  liveTrackingEnabled: false,
  openTrackingEnabled: false,
  async load(source, _intent) {
    if (source.type !== 'dss') return LoadErrors.MISSING;
    if (source.id !== CALENDAR_BLOCK_ID) return LoadErrors.INVALID;
    return ok({ id: source.id });
  },
  accepted: {},
});

export type CalendarData = ExtractLoadType<(typeof definition)['load']>;
