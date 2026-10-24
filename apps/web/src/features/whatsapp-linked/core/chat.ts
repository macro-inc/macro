/** Where a WhatsApp chat already is in Macro for this viewer. */
export type InMacro =
  | { kind: 'own'; groupId: string }
  | { kind: 'shared'; groupId: string; ownerId: string; ownerName: string };

/** A conversation in the connected account's WhatsApp chat list. */
export type WhatsAppChat = {
  jid: string;
  kind: 'group' | 'direct';
  /** WhatsApp's subject or contact name, or DSS's fallback; never empty. */
  name: string;
  /** Newest message WhatsApp reported, when known. */
  lastActivityAt: string | undefined;
  archived: boolean;
  inMacro: InMacro | undefined;
  /** "Add to Macro" works now. */
  canAdd: boolean;
  /** DSS's reason this chat can't be added, when it can't. */
  cannotAddReason: string | undefined;
};

/**
 * The WhatsApp page's three lists, in DSS's recent-activity order. `query`
 * keeps the chats whose name matches.
 */
export function chatSections(chats: WhatsAppChat[], query = '') {
  const visible = chats.filter((chat) => matchesChatQuery(chat, query));
  return {
    inMacro: visible.filter((chat) => chat.inMacro?.kind === 'own'),
    /** Not yet in Macro for this viewer, or shared with them by someone else. */
    addable: visible.filter(
      (chat) =>
        chat.inMacro?.kind !== 'own' &&
        (chat.canAdd || chat.inMacro?.kind === 'shared')
    ),
    unsupported: visible.filter(
      (chat) => !chat.inMacro && !chat.canAdd && !!chat.cannotAddReason
    ),
  };
}

const fold = (text: string) =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();

/** Case- and accent-insensitive; a phone number matches with or without spacing. */
export function matchesChatQuery(chat: WhatsAppChat, query: string): boolean {
  const wanted = fold(query.trim());
  if (!wanted) return true;
  if (fold(chat.name).includes(wanted)) return true;
  const digits = wanted.replace(/[\s()+-]/g, '');
  return /^\d+$/.test(digits) && chat.name.replace(/\D/g, '').includes(digits);
}

/** DSS's refusal sentence, shortened for direct chats. */
export function cannotAddLabel(chat: WhatsAppChat): string | undefined {
  if (chat.kind === 'direct') return "Can't add direct chats yet";
  const reason = chat.cannotAddReason;
  return reason
    ? `${reason.charAt(0).toUpperCase()}${reason.slice(1)}`
    : undefined;
}

/** "Group", "Direct chat · Archived"; the row shows last activity apart. */
export function chatMetadata(chat: WhatsAppChat): string {
  return [
    chat.kind === 'direct' ? 'Direct chat' : 'Group',
    chat.archived ? 'Archived' : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
}
