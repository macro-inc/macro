// Hand-written types for the channel shape the REST channel list (`GET /comms/channels`)
// returned: the channel, its participants, and the latest-message info flattened into one
// object, using the generated service-storage primitives. The web app no longer reads that
// list; the channel directory still projects its records into this shape for readers that
// take it. (service-storage's generated `SoupChannel` nests these under `.channel` and is
// therefore not interchangeable.)
import type { AgentDmProfile } from './generated/schemas/agentDmProfile';
import type { Channel } from './generated/schemas/channel';
import type { ChannelParticipant } from './generated/schemas/channelParticipant';
import type { LatestMessage } from './generated/schemas/latestMessage';

/** Channel metadata with its participants (channel fields flattened to the top level). */
export type ChannelWithParticipants = Channel & {
  /** Whether current and future team members automatically join the channel. */
  auto_join_team: boolean;
  participants: ChannelParticipant[];
  /** Whether the requesting user is an active participant of the channel. */
  is_participant: boolean;
};

/** A channel-list item: channel + participants + latest message + the viewer's read state. */
export type ApiChannelWithLatest = ChannelWithParticipants &
  LatestMessage & {
    agent_dm?: AgentDmProfile;
    frecency_score?: number | null;
    interacted_at?: string | null;
    viewed_at?: string | null;
  };
