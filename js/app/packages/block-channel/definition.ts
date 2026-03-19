import { defineBlock, type ExtractLoadType, LoadErrors } from '@core/block';
import { ok } from '@core/util/maybeResult';
import ChannelBlock from './component/Block';
import { fetchAndCacheChannel } from '@queries/channel/channel';
import { ENABLE_NEW_CHANNELS } from '@core/constant/featureFlags';
import { NewChannelBlockAdapter } from './component/NewChannelBlockAdapter';

export const definition = defineBlock({
  name: 'channel',
  description: '',
  component: ENABLE_NEW_CHANNELS ? NewChannelBlockAdapter : ChannelBlock,
  liveTrackingEnabled: true,
  async load(source, _intent) {
    if (source.type === 'dss') {
      if (!ENABLE_NEW_CHANNELS) {
        await fetchAndCacheChannel(source.id);
      }
      return ok({ id: source.id });
    }
    return LoadErrors.MISSING;
  },
  accepted: {},
});

export type ChannelData = ExtractLoadType<(typeof definition)['load']>;
