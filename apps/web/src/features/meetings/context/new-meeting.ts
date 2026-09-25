import type { Accessor } from 'solid-js';
import type { MeetingInvitePerson } from './meeting-invite';

export type NewMeeting = { id: string; shareToken: string };

export type NewMeetingCapabilities = {
  people: Accessor<MeetingInvitePerson[]>;
  create: () => Promise<NewMeeting>;
  invite: (shareToken: string, userIds: string[]) => Promise<unknown>;
};
