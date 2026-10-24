import { match } from 'ts-pattern';

/** Where a WhatsApp group already is in Macro for this viewer. */
export type InMacro =
  | { kind: 'own'; groupId: string }
  | { kind: 'shared'; groupId: string; ownerId: string; ownerName: string };

/** A WhatsApp group the connected account belongs to. */
export type WhatsAppGroup = {
  jid: string;
  /** WhatsApp's subject, or DSS's member-name fallback for unnamed groups. */
  name: string;
  memberCount: number;
  inMacro: InMacro | undefined;
  /** Why this group cannot be added, when it cannot. */
  unsupported: 'community' | 'disappearing' | undefined;
};

/** The WhatsApp page's two lists; groups already added live in External's sidebar. */
export function groupSections(groups: WhatsAppGroup[]) {
  return {
    /** Not yet in Macro for this viewer, or shared with them by someone else. */
    addable: groups.filter(
      (group) => !group.unsupported && group.inMacro?.kind !== 'own'
    ),
    unsupported: groups.filter(
      (group) => group.unsupported && group.inMacro?.kind !== 'own'
    ),
  };
}

export function unsupportedReason(
  reason: NonNullable<WhatsAppGroup['unsupported']>
): string {
  return match(reason)
    .with('community', () => 'WhatsApp communities aren’t supported yet')
    .with('disappearing', () => 'Disappearing messages are on')
    .exhaustive();
}

/** Up to two initials from the words of a group name that start with a letter. */
export function groupInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter((word) => /^\p{L}/u.test(word))
    .slice(0, 2)
    .map((word) => word[0]?.toLocaleUpperCase() ?? '')
    .join('');
}
