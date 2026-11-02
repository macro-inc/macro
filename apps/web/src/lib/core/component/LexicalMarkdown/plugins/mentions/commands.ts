import type {
  AgentSessionMentionInfo,
  BookingLinkMentionInfo,
  ContactMentionInfo,
  DateMentionInfo,
  DocumentMentionInfo,
  GroupMentionInfo,
  PullRequestMentionInfo,
  ThemeMentionInfo,
  UserMentionInfo,
} from '@macro-inc/lexical-core';
import { createCommand, type LexicalCommand } from 'lexical';

export const INSERT_DOCUMENT_MENTION_COMMAND: LexicalCommand<DocumentMentionInfo> =
  createCommand('INSERT_DOCUMENT_MENTION_COMMAND');

export const INSERT_CONTACT_MENTION_COMMAND: LexicalCommand<ContactMentionInfo> =
  createCommand('INSERT_CONTACT_MENTION_COMMAND');

export const INSERT_DATE_MENTION_COMMAND: LexicalCommand<DateMentionInfo> =
  createCommand('INSERT_DATE_MENTION_COMMAND');

export const CLOSE_INLINE_SEARCH_COMMAND: LexicalCommand<void> = createCommand(
  'CLOSE_INLINE_SEARCH_COMMAND'
);

/** Opens the mention typeahead at the caret, as typing `@` there does. */
export const TYPE_AT_SYMBOL_COMMAND: LexicalCommand<void> = createCommand(
  'TYPE_AT_SYMBOL_COMMAND'
);

export const REMOVE_INLINE_SEARCH_COMMAND: LexicalCommand<void> = createCommand(
  'REMOVE_INLINE_SEARCH_COMMAND'
);

export const UPDATE_DOCUMENT_NAME_COMMAND: LexicalCommand<
  Record<string, string>
> = createCommand('UPDATE_DOCUMENT_NAME_COMMAND');

export const UPDATE_USER_DISPLAY_NAME_COMMAND: LexicalCommand<
  Record<string, string>
> = createCommand('UPDATE_USER_DISPLAY_NAME_COMMAND');

export const INSERT_USER_MENTION_COMMAND: LexicalCommand<UserMentionInfo> =
  createCommand('INSERT_USER_MENTION_COMMAND');

export const INSERT_GROUP_MENTION_COMMAND: LexicalCommand<GroupMentionInfo> =
  createCommand('INSERT_GROUP_MENTION_COMMAND');

export const INSERT_AGENT_SESSION_MENTION_COMMAND: LexicalCommand<AgentSessionMentionInfo> =
  createCommand('INSERT_AGENT_SESSION_MENTION_COMMAND');

export const INSERT_PR_MENTION_COMMAND: LexicalCommand<PullRequestMentionInfo> =
  createCommand('INSERT_PR_MENTION_COMMAND');

export const INSERT_THEME_MENTION_COMMAND: LexicalCommand<ThemeMentionInfo> =
  createCommand('INSERT_THEME_MENTION_COMMAND');

export const INSERT_BOOKING_LINK_MENTION_COMMAND: LexicalCommand<BookingLinkMentionInfo> =
  createCommand('INSERT_BOOKING_LINK_MENTION_COMMAND');
