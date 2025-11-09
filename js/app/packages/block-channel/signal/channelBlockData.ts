import { blockDataSignalAs } from '@core/block';
import type { ChannelData } from '../definition';
export const channelBlockDataSignal = blockDataSignalAs<ChannelData>('channel');
