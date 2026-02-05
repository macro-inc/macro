import { useEmail } from '@core/context/user';
import { emailToMacroId, useDisplayName } from '@core/user';
import type { EmailEntity } from '../types/entity';

/** Checks if a value is likely an email address */
export function isLikelyEmail(value?: string): boolean {
  return typeof value === 'string' && value.includes('@');
}

/** Extracts the local part of an email address (before @) */
export function getEmailLocalPart(email: string): string {
  return email.split('@')[0];
}

/**
 * Resolves the best display name for a participant
 * Priority: macroDisplayName > participant.name > email local part
 */
export function resolveParticipantName(
  participant: { email: string; name: string },
  macroDisplayName?: string
): string {
  if (macroDisplayName && !isLikelyEmail(macroDisplayName)) {
    return macroDisplayName;
  }
  const participantFullName = participant.name ?? '';
  if (participantFullName && !isLikelyEmail(participantFullName)) {
    return participantFullName;
  }
  return getEmailLocalPart(participant.email);
}

/**
 * Combines participant names into a list, handling the "me" case
 * Returns an array of display names (possibly ["me"] if single participant is userEmail)
 */
export function combineParticipantNames(
  participants: Array<{ email: string; name: string }> | undefined,
  userEmail: string | undefined,
  getMacroDisplayName: (email: string) => string | undefined
): string[] {
  if (!participants || participants.length === 0) {
    return [];
  }

  if (
    participants.length === 1 &&
    userEmail &&
    participants[0].email === userEmail
  ) {
    return ['me'];
  }

  const namesSet = new Set<string>();

  for (const participant of participants) {
    if (!participant.email) continue;

    if (userEmail && participant.email === userEmail) continue;

    const macroDisplayName = getMacroDisplayName(participant.email);
    const displayName = resolveParticipantName(participant, macroDisplayName);

    namesSet.add(displayName);
  }

  return Array.from(namesSet);
}

/**
 * Formats display names into a string suitable for UI display
 * - Single name: returns as-is
 * - 2-3 names: comma-separated with first names only
 * - 4+ names: "First .. SecondLast, Last" format with first names
 */
export function formatDisplayNames(names: string[]): string | undefined {
  if (!names || names.length === 0) return undefined;
  if (names.length === 1) return names[0];

  // For multiple participants, use first names only
  const firstNames = names.map((name) => name.split(' ')[0]);

  if (firstNames.length <= 3) {
    return firstNames.join(', ');
  }

  // For 4+ participants: "First .. SecondLast, Last"
  return `${firstNames[0]} .. ${firstNames[firstNames.length - 2]}, ${firstNames[firstNames.length - 1]}`;
}

/**
 * Get a nicely formatted list of participants from an email entity.
 * @param props
 * @returns
 */
export function EntityEmailParticipants(props: { entity: EmailEntity }) {
  const userEmail = useEmail();
  const fetchDisplayName = (email: string) =>
    useDisplayName(emailToMacroId(email))[0]();

  const displayNames = () => {
    return formatDisplayNames(
      combineParticipantNames(
        props.entity.participants,
        userEmail(),
        fetchDisplayName
      )
    );
  };

  return <>{displayNames()}</>;
}
