import { defineBlock, type ExtractLoadType, LoadErrors } from '@core/block';
import { isErr, ok } from '@core/util/maybeResult';
import {
  fetchAndCacheChannel,
  optimisticUpdateChannelViewedAt,
} from '@queries/channel/channel';
import { optimisticUpdateViewedAt } from '@queries/history/history';
import ChannelBlock from './component/Block';

export const definition = defineBlock({
  name: 'channel',
  description: '',
  component: ChannelBlock,
  liveTrackingEnabled: true,
  async load(source, _intent) {
    if (source.type === 'dss') {
      const channel = await fetchAndCacheChannel(source.id);

      if (isErr(channel)) {
        if (isErr(channel, 'MISSING')) {
          return LoadErrors.MISSING;
        } else if (isErr(channel, 'UNAUTHORIZED')) {
          return LoadErrors.UNAUTHORIZED;
        } else if (isErr(channel, 'GONE')) {
          return LoadErrors.GONE;
        } else {
          return LoadErrors.INVALID;
        }
      }

      const [, channelData] = channel;

      optimisticUpdateViewedAt(source.id);
      optimisticUpdateChannelViewedAt(source.id);

      return ok({
        ...channelData.channel,
      });
    }

    return LoadErrors.MISSING;
  },
  accepted: {},
});

export type ChannelData = ExtractLoadType<(typeof definition)['load']>;
