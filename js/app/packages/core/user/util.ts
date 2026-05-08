import { useDisplayName } from './displayName';
import {
  emailToMacroId,
  type MacroId,
  macroIdToEmail,
  tryMacroId,
} from './macroId';
import type { IUser } from './types';

export { emailToMacroId, type MacroId, macroIdToEmail, tryMacroId };

// TODO: consolidate idToEmail, see idToEmail in email.ts
/**
 * Converts a user id to an email address.
 * @deprecated Use `macroIdToEmail` with a validated `MacroId` instead.
 */
export function idToEmail(id: string): string {
  return id.replace('macro|', '');
}

/**
 * Converts an email address to a user id.
 * @deprecated Use `emailToMacroId` instead for type-safe MacroId creation.
 */
export function emailToId(email: string): string {
  return `macro|${email}`;
}

export function idToDisplayName(id: string): string {
  const macroId = tryMacroId(id);
  const [displayName] = useDisplayName(macroId);
  return displayName();
}

export function channelParticipantInfo(participant: {
  user_id: string;
}): IUser {
  const id = participant.user_id;
  return {
    id,
    email: idToEmail(id),
    name: idToDisplayName(id),
  };
}
