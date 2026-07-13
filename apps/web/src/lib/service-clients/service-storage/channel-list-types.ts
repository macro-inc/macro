// Hand-written types for the channel-list read model returned by `GET /comms/channels`
// (served by the comms hex). The response flattens the channel, its participants, and the
// latest-message info into a single object, so these mirror that flattened shape using the
// generated service-storage primitives. (Previously generated as `@service-comms`'s
// `ApiChannelWithLatest`; service-storage's generated `SoupChannel` nests these under
// `.channel` and is therefore not interchangeable.)
import type { Channel } from './generated/schemas/channel';
import type { ChannelParticipant } from './generated/schemas/channelParticipant';
import type { LatestMessage } from './generated/schemas/latestMessage';

/** Channel metadata with its participants (channel fields flattened to the top level). */
export type ChannelWithParticipants = Channel & {
  participants: ChannelParticipant[];
};

/** A channel-list item: channel + participants + latest message + the viewer's read state. */
export type ApiChannelWithLatest = ChannelWithParticipants &
  LatestMessage & {
    frecency_score?: number | null;
    interacted_at?: string | null;
    viewed_at?: string | null;
  };
