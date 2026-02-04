import type { Accessor } from 'solid-js';

export type { ChannelWithParticipants } from '@service-comms/generated/models';
export type { ContactInfo } from '@service-email/generated/schemas';

export interface IOrganizationUser {
  email: string;
  id: string;
  is_it_admin: boolean;
}

export type IUser = {
  id: string;
  email: string;
  name: string;
  lastInteraction?: number;
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
