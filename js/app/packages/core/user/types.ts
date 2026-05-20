import type { DateValue } from '@core/util/date';
import type { Accessor } from 'solid-js';

export type { ChannelWithParticipants } from '@service-comms/generated/models';
export type { ContactInfo } from '@service-email/generated/schemas';

export type IUser = {
  id: string;
  email: string;
  name: string;
  lastInteraction?: DateValue;
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
