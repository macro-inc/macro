import { createBlockSignal } from '@core/block';
import type { ChannelWithParticipants } from '@core/user';

export const contactChannelsSignal = createBlockSignal<
  ChannelWithParticipants[]
>([]);
export const isLoadingChannelsSignal = createBlockSignal(false);
