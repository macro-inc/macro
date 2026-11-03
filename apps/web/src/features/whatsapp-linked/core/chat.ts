import { isSameDay } from '@core/util/time';
import { match } from 'ts-pattern';
/** Where a WhatsApp chat already is in Macro for this viewer. */
export type InMacro =
  | { kind: 'own'; chatId: string }
  | { kind: 'shared'; chatId: string; ownerId: string; ownerName: string };

/** The WhatsApp community a group belongs to. */
export type ChatCommunity = {
  /** The community's WhatsApp JID. */
  id: string;
  name: string;
  /** The community's announcement group (named after the community). */
  announcements: boolean;
};

/**
 * "Launch · Design", or "Launch · Announcements": WhatsApp names a
 * community's groups under it.
 */
export function communityTitle(
  name: string,
  community: ChatCommunity | undefined
): string {
  if (!community) return name;
  return `${community.name} · ${community.announcements ? 'Announcements' : name}`;
}

/** A conversation in the connected account's WhatsApp chat list. */
export type WhatsAppChat = {
  jid: string;
  kind: 'group' | 'direct';
  /** WhatsApp's subject or contact name, or DSS's fallback; never empty. */
  name: string;
  /** The other person's number (`+<digits>`) of a direct chat, when known. */
  phoneNumber: string | undefined;
  /** Newest message WhatsApp reported; unknown for contacts never written to. */
  lastActivityAt: string | undefined;
  archived: boolean;
  inMacro: InMacro | undefined;
  /** "Add to Macro" works now. */
  canAdd: boolean;
  /** DSS's reason this chat can't be added, when it can't. */
  /** Why DSS says it can't be added; the words are ours (`cannotAddLabel`). */
  cannotAddReason: CannotAdd | undefined;
  /** Set for a group inside a WhatsApp community. */
  community?: ChatCommunity;
};

/** A saved contact (or looked-up number) nobody has written to yet. */
const isUnwrittenContact = (chat: WhatsAppChat) =>
  chat.kind === 'direct' && !chat.lastActivityAt && !chat.inMacro;

/**
 * The WhatsApp page's lists, in DSS's recent-activity order. `listed` holds
 * the chats to add and those shared with the viewer, plus (while searching)
 * the viewer's own added chats, which otherwise live in External's sidebar.
 * `contacts` holds people to start a chat with: saved contacts nobody wrote
 * to yet. `query` keeps the chats whose name or number matches.
 */
export function chatSections(chats: WhatsAppChat[], query = '') {
  const searching = query.trim() !== '';
  const visible = chats.filter((chat) => matchesChatQuery(chat, query));
  return {
    listed: visible.filter((chat) =>
      chat.inMacro?.kind === 'own'
        ? searching
        : !isUnwrittenContact(chat) &&
          (chat.canAdd || chat.inMacro?.kind === 'shared')
    ),
    contacts: visible.filter((chat) => isUnwrittenContact(chat) && chat.canAdd),
    unsupported: visible.filter(
      (chat) => !chat.inMacro && !chat.canAdd && !!chat.cannotAddReason
    ),
  };
}

/** Anything listed as a WhatsApp conversation: a page chat or a sidebar group. */
type Conversation = {
  kind: 'group' | 'direct';
  community?: ChatCommunity;
};

/** A list sorted the way WhatsApp's own app groups it, each part in list order. */
export type ConversationSections<Item> = {
  direct: Item[];
  groups: Item[];
  /** One per community, ordered by its most recent group. */
  communities: { community: ChatCommunity; items: Item[] }[];
};

/** Splits a recent-first list into direct chats, plain groups and communities. */
export function conversationSections<Item extends Conversation>(
  items: readonly Item[]
): ConversationSections<Item> {
  const sections: ConversationSections<Item> = {
    direct: [],
    groups: [],
    communities: [],
  };
  const byCommunity = new Map<string, Item[]>();
  for (const item of items) {
    if (item.kind === 'direct') {
      sections.direct.push(item);
      continue;
    }
    const community = item.community;
    if (!community) {
      sections.groups.push(item);
      continue;
    }
    const known = byCommunity.get(community.id);
    if (known) {
      known.push(item);
      continue;
    }
    const started = [item];
    byCommunity.set(community.id, started);
    sections.communities.push({ community, items: started });
  }
  return sections;
}

/** A community's group as listed under its community: its own name, or "Announcements". */
export function nameInCommunity(item: {
  name: string;
  community?: ChatCommunity;
}): string {
  return item.community?.announcements ? 'Announcements' : item.name;
}

const fold = (text: string) =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();

/** Case- and accent-insensitive; a phone number matches with or without spacing. */
export function matchesChatQuery(chat: WhatsAppChat, query: string): boolean {
  const wanted = fold(query.trim());
  if (!wanted) return true;
  if (fold(communityTitle(chat.name, chat.community)).includes(wanted))
    return true;
  const digits = wanted.replace(/[\s()+-]/g, '');
  return (
    /^\d+$/.test(digits) &&
    [chat.name, chat.phoneNumber ?? ''].some((text) =>
      text.replace(/\D/g, '').includes(digits)
    )
  );
}

/** Why a chat can't be added to Macro, as DSS reports it. */
export type CannotAdd =
  | 'not_in_group'
  | 'community'
  | 'own_chat'
  | 'not_in_chat_list';

/** The reason a chat can't be added, in the page's words. */
export function cannotAddMessage(reason: CannotAdd): string {
  return match(reason)
    .with('not_in_group', () => "Your WhatsApp isn't in this group anymore")
    .with(
      'community',
      () => 'A community has no messages of its own; add one of its groups'
    )
    .with('own_chat', () => "Your chat with yourself can't be added")
    .with(
      'not_in_chat_list',
      () => "This chat isn't in your WhatsApp chat list yet"
    )
    .exhaustive();
}

/** A row's "can't be added" note, when it has one. */
export function cannotAddLabel(chat: WhatsAppChat): string | undefined {
  return chat.cannotAddReason
    ? cannotAddMessage(chat.cannotAddReason)
    : undefined;
}

/**
 * "Group", "Direct chat · +351 …" (the number when the name isn't it),
 * "Direct chat · Archived"; the row shows last activity apart.
 */
export function chatMetadata(chat: WhatsAppChat): string {
  return [
    chat.kind === 'direct'
      ? 'Direct chat'
      : chat.community?.announcements
        ? 'Announcement group'
        : chat.community
          ? 'Community group'
          : 'Group',
    chat.phoneNumber !== chat.name ? chat.phoneNumber : undefined,
    chat.archived ? 'Archived' : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** "Today", "Yesterday", or a full date with its year, so every row reads alike. */
export function formatActivityDate(
  value: string,
  now: Date = new Date()
): string {
  const date = new Date(value);
  if (isSameDay(date, now)) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) return 'Yesterday';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
