import type { ChannelEntity } from '@entity/types/entity';
import type { Accessor } from 'solid-js';

export type ChannelSelection = Pick<ChannelEntity, 'id' | 'target'>;

export type ChannelDestination =
  | { kind: 'latest' }
  | { kind: 'message'; messageId: string; threadId?: string };

export type ChannelDetailLoad =
  | { status: 'pending' }
  | { status: 'error'; error: Error }
  | { status: 'ready'; channel: ChannelEntity | undefined };

/** A ready result contains the complete notification source for this open. */
export type ChannelDetailSource = {
  load: Accessor<ChannelDetailLoad>;
  refresh: () => Promise<void>;
};
