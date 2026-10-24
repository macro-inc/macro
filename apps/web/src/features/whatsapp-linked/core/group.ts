/** A WhatsApp group the connected account belongs to. */
export type WhatsAppGroup = {
  jid: string;
  name: string;
  memberCount: number;
  /** The shareable Macro group entity. */
  group: { id: string; name: string } | undefined;
  unreadCount?: number;
  /** Why this group cannot be added, when it cannot. */
  unsupported: 'community' | 'disappearing' | undefined;
};

/** Up to two initials from the words of a group name that start with a letter. */
export function groupInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter((word) => /^\p{L}/u.test(word))
    .slice(0, 2)
    .map((word) => word[0]?.toLocaleUpperCase() ?? '')
    .join('');
}
