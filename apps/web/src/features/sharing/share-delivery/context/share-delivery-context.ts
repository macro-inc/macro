import type { Result } from 'neverthrow';
import type { ShareEvent, ShareTarget } from '../core/delivery-plan';
import type {
  ChannelAccessChange,
  ChannelAccessError,
  ShareItemRef,
} from '../core/share-item';

export type OutgoingMessage = {
  readonly to: ShareTarget;
  readonly messageId: string;
  readonly items: readonly ShareItemRef[];
  readonly text: string;
  readonly beforeSend?: (channelId: string) => Promise<void>;
};

export type SentMessage = {
  readonly channelId: string;
  readonly open: () => void;
};

export type ShareDeliveryContext = {
  readonly send: (message: OutgoingMessage) => Promise<SentMessage | undefined>;
  readonly changeChannelAccess: (
    item: ShareItemRef,
    change: ChannelAccessChange
  ) => Promise<Result<void, ChannelAccessError>>;
  readonly track: (event: ShareEvent) => void;
};
