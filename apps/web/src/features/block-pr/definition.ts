import { defineBlock, type ExtractLoadType, LoadErrors } from '@core/block';
import { ok } from 'neverthrow';
import { lazy } from 'solid-js';

export const definition = defineBlock({
  name: 'pr',
  description: 'View a GitHub pull request',
  // Lazy so the Pierre/shiki diff stack stays out of the main chunk.
  component: lazy(() => import('./component/Block')),
  liveTrackingEnabled: false,
  async load(source, _intent) {
    if (source.type === 'dss') {
      if (!source.id) return LoadErrors.INVALID;
      return ok({ id: source.id });
    }
    return LoadErrors.MISSING;
  },
  accepted: {},
});

export type PrData = ExtractLoadType<(typeof definition)['load']>;
