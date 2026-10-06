import type { Result } from 'neverthrow';
import type { ShareEvent, ShareTarget } from '../core/delivery-plan';
import type {
  ChannelAccessChange,
  ChannelAccessError,
  ShareItemRef,
} from '../core/share-item';

export type OutgoingMessage = {
  /** A known channel posts directly. People resolve their DM or group channel first. */
  readonly to: ShareTarget;
  /** Every retry of one planned message posts under its id. */
  readonly messageId: string;
  /** At most `MAX_ATTACHMENTS_PER_MESSAGE`. The plan guarantees it. */
  readonly items: readonly ShareItemRef[];
  readonly text: string;
  /** Runs once the target's channel exists and before the post. A rejection stops the post. */
  readonly beforeSend?: (channelId: string) => Promise<void>;
};

export type SentMessage = {
  readonly channelId: string;
  /** Opens the conversation at this message. */
  readonly open: () => void;
};

/**
 * The app capabilities a share form needs. `share-delivery.ts` wires the
 * production ones, and tests pass fakes.
 */
export type ShareDeliveryContext = {
  /**
   * Resolves once the server holds the message, including a conflict on its
   * reused id. Resolves undefined when the channel lookup or the post fails.
   * Rejects only when `beforeSend` rejects.
   */
  readonly send: (message: OutgoingMessage) => Promise<SentMessage | undefined>;
  readonly changeChannelAccess: (
    item: ShareItemRef,
    change: ChannelAccessChange
  ) => Promise<Result<void, ChannelAccessError>>;
  readonly track: (event: ShareEvent) => void;
};
