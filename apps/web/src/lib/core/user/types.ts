import type { DateValue } from '@core/util/date';
import type { Accessor } from 'solid-js';

export type { ContactInfo } from '@service-email/generated/schemas';
export type { ChannelWithParticipants } from '@service-storage/channel-list-types';

export type IUser = {
  id: string;
  email: string;
  name: string;
  photoUrl?: string;
  lastInteraction?: DateValue;
  /**
   * Set on agent principals whose runtime is paired but not connected. The
   * mention menu marks them "Offline" and refuses to insert them, since the
   * machine that would answer is away.
   */
  offline?: boolean;
};

type BaseUserName = {
  _createdAt: Date;
  id: string;
  firstName?: string;
  lastName?: string;
};

type UserNameLoading = { loading: true } & BaseUserName;
type UserNameLoaded = { loading: false } & BaseUserName;

export type UserNameItem = UserNameLoading | UserNameLoaded;

export type UserNamePreviewFetcher = [
  Accessor<string>,
  {
    refetch: () => void;
    mutate: (value: UserNameItem) => void;
  },
];
