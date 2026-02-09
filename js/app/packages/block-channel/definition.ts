import { defineBlock, type ExtractLoadType, LoadErrors } from '@core/block';
import { ok } from '@core/util/maybeResult';
import ChannelBlock from './component/Block';
import { fetchAndCacheChannel } from '@queries/channel/channel';

export const definition = defineBlock({
  name: 'channel',
  description: '',
  component: ChannelBlock,
  liveTrackingEnabled: true,
  async load(source, _intent) {
    if (source.type === 'dss') {
      await fetchAndCacheChannel(source.id);
      return ok({ id: source.id });
    }
    return LoadErrors.MISSING;
  },
  accepted: {},
});

export type ChannelData = ExtractLoadType<(typeof definition)['load']>;
