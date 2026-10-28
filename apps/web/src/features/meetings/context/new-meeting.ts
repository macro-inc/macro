import type { Accessor } from 'solid-js';
import type { MeetingInvitePerson } from './meeting-invite';

export type NewMeeting = { id: string; shareToken: string };
export type MeetingPreparation = { id: string; expiresAt: string };

export type NewMeetingCapabilities = {
  people: Accessor<MeetingInvitePerson[]>;
  prepareRoom: () => Promise<MeetingPreparation>;
  cancelRoom: (id: string) => Promise<unknown>;
  create: (preparationId?: string) => Promise<NewMeeting>;
  invite: (shareToken: string, userIds: string[]) => Promise<unknown>;
};
