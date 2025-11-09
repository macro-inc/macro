import type { ChannelParticipant } from '@service-comms/generated/models';
import { useDisplayName } from './displayName';
import type { IUser } from './types';

// TODO: consolidate idToEmail, see idToEmail in email.ts
/** Converts a user id to an email address */
export function idToEmail(id: string): string {
  return id.replace('macro|', '');
}

/** Converts an email address to a user id */
export function emailToId(email: string): string {
  return `macro|${email}`;
}

export function idToDisplayName(id: string): string {
  const [displayName] = useDisplayName(id);
  return displayName();
}

export function channelParticipantInfo(participant: ChannelParticipant): IUser {
  const id = participant.user_id;
  return {
    id,
    email: idToEmail(id),
    name: idToDisplayName(id),
  };
}
