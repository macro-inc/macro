import { defineBlock, type ExtractLoadType, LoadErrors } from '@core/block';
import { ok } from 'neverthrow';
import { lazy } from 'solid-js';

export const definition = defineBlock({
  name: 'channel',
  description: '',
  component: lazy(() =>
    import('./component/NewChannelBlockAdapter').then((module) => ({
      default: module.NewChannelBlockAdapter,
    }))
  ),
  liveTrackingEnabled: true,
  async load(source, _intent) {
    if (source.type === 'dss') {
      return ok({ id: source.id });
    }
    return LoadErrors.MISSING;
  },
  accepted: {},
});

export type ChannelData = ExtractLoadType<(typeof definition)['load']>;
