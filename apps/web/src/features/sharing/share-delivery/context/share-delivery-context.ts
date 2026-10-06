import type { Result } from 'neverthrow';
import type { ShareEvent } from '../core/delivery-plan';
import type {
  ChannelAccessChange,
  ChannelAccessError,
  ShareItemRef,
} from '../core/share-item';

export type OutgoingMessage = {
  readonly channelId: string;
  readonly messageId: string;
  readonly items: readonly ShareItemRef[];
  readonly text: string;
};

export type SentMessage = {
  readonly open: () => void;
};

export type ShareDeliveryContext = {
  readonly resolvePeopleChannel: (
    userIds: readonly string[]
  ) => Promise<string | undefined>;
  readonly send: (message: OutgoingMessage) => Promise<SentMessage | undefined>;
  readonly changeChannelAccess: (
    item: ShareItemRef,
    change: ChannelAccessChange
  ) => Promise<Result<void, ChannelAccessError>>;
  readonly track: (event: ShareEvent) => void;
};
