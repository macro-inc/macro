import type { ApiChannelParticipant } from '@service-storage/client';

export type ChannelParticipant = ApiChannelParticipant & {
  left_at?: string | null;
};
