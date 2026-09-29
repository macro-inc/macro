import type { Accessor } from 'solid-js';

export type MeetingInvitePerson = {
  id: string;
  email: string;
  name: string;
};

export type MeetingTeammatesSource = {
  people: Accessor<MeetingInvitePerson[]>;
  loading: Accessor<boolean>;
  error: Accessor<string | undefined>;
  refresh: () => void;
};
