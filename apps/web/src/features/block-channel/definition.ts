import { ChannelLoading } from '@channel/Channel/ChannelLoading';
import { defineBlock, type ExtractLoadType, LoadErrors } from '@core/block';
import { lazy } from '@core/util/lazy';
import { ok } from 'neverthrow';

export const definition = defineBlock({
  name: 'channel',
  description: '',
  loading: ChannelLoading,
  component: lazy(async () => ({
    default: (await import('./component/NewChannelBlockAdapter'))
      .NewChannelBlockAdapter,
  })),
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
