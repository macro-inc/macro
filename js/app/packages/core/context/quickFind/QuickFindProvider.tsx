import { useChannelsContext } from '@core/context/channels';
import {
  type ChannelWithParticipants,
  useAugmentUserWithDmActivity,
  useContacts,
} from '@core/user';
import { useEmails, type EmailEntity } from '@macro-entity';
import { useHistoryQuery, type HistoryItem } from '@queries/history/history';
import { createMemo } from 'solid-js';
import { createAssertedContextProvider } from '../createContext';
import type {
  QuickFindCategory,
  QuickFindCollections,
  QuickFindContextValue,
  QuickFindItem,
} from './types';
import { createLazyMemo } from '@solid-primitives/memo';

type HistoryCategory = 'document' | 'note' | 'task' | 'chat' | 'folder';

/**
 * Categorizes a history item into a HistoryCategory.
 */
function categorizeHistoryItem(item: HistoryItem): HistoryCategory {
  switch (item.type) {
    case 'chat':
      return 'chat';
    case 'project':
      return 'folder';
    case 'document': {
      if (item.subType?.type === 'task') {
        return 'task';
      }
      if (item.fileType === 'md') {
        return 'note';
      }
      return 'document';
    }
    default:
      return 'document';
  }
}

/**
 * Gets search text for a user.
 * Returns email twice for users without display names to help with ranking.
 */
function getUserSearchText(user: { name: string; email: string }): string {
  const { email, name } = user;
  if (name === email) return `${email} | ${email}`;
  return `${name} | ${email}`;
}

/**
 * Gets search text for a channel.
 */
function getChannelSearchText(channel: ChannelWithParticipants): string {
  return channel.name ?? '';
}

/**
 * Gets search text for an email.
 */
function getEmailSearchText(email: EmailEntity): string {
  return email.name ?? 'No Subject';
}

/**
 * Gets search text for a history item.
 */
function getHistoryItemSearchText(item: HistoryItem): string {
  return item.name;
}

/**
 * Parses a timestamp that could be a number or ISO string.
 */
function parseTimestamp(value: number | string | null | undefined): number {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  return new Date(value).getTime();
}

export const [QuickFindProvider, useQuickFind] = createAssertedContextProvider(
  'QuickFindContext',
  (): QuickFindContextValue => {
    const historyQuery = useHistoryQuery();
    const { channels, isLoading: channelsLoading } = useChannelsContext();
    const contacts = useContacts();
    const emails = useEmails();
    const augmentUserWithDmActivity = useAugmentUserWithDmActivity();

    const collections = createLazyMemo<QuickFindCollections>(() => {
      const all: QuickFindItem[] = [];
      const categories: QuickFindCategory[] = [
        'user',
        'channel',
        'dm',
        'document',
        'note',
        'task',
        'chat',
        'folder',
        'email',
      ] as const;

      const byCategory = new Map(
        categories.map((c) => [c, [] as Array<QuickFindItem>])
      );

      const historyData = historyQuery.data ?? [];
      for (const item of historyData) {
        if (item.deletedAt) continue;

        const category = categorizeHistoryItem(item);
        const quickFindItem: QuickFindItem<HistoryCategory> = {
          id: item.id,
          category,
          searchText: getHistoryItemSearchText(item),
          timestamp: item.viewedAt ?? item.updatedAt ?? 0,
          updatedAt: item.updatedAt ?? undefined,
          data: item,
        };

        all.push(quickFindItem);
        byCategory.get(category)!.push(quickFindItem);
      }

      // Transform channels
      const channelData = channels();
      for (const channel of channelData) {
        const category: QuickFindCategory =
          channel.channel_type === 'direct_message' ? 'dm' : 'channel';

        const quickFindItem: QuickFindItem<'channel' | 'dm'> = {
          id: channel.id,
          category,
          searchText: getChannelSearchText(channel),
          timestamp: parseTimestamp(channel.viewed_at ?? channel.updated_at),
          updatedAt: parseTimestamp(channel.updated_at),
          data: channel as ChannelWithParticipants,
        };

        all.push(quickFindItem);
        byCategory.get(category)!.push(quickFindItem);
      }

      // Transform users (contacts) with DM activity
      const contactData = contacts();
      for (const contact of contactData) {
        const augmentedUser = augmentUserWithDmActivity(contact);

        const quickFindItem: QuickFindItem<'user'> = {
          id: augmentedUser.id,
          category: 'user',
          searchText: getUserSearchText(augmentedUser),
          timestamp: augmentedUser.lastInteraction ?? 0,
          lastInteraction: augmentedUser.lastInteraction,
          data: augmentedUser,
        };

        all.push(quickFindItem);
        byCategory.get('user')!.push(quickFindItem);
      }

      // Transform emails
      const emailData = emails();
      for (const email of emailData) {
        const quickFindItem: QuickFindItem<'email'> = {
          id: email.id,
          category: 'email',
          searchText: getEmailSearchText(email),
          timestamp: email.viewedAt ?? email.updatedAt ?? 0,
          updatedAt: email.updatedAt ?? undefined,
          data: email,
        };

        all.push(quickFindItem);
        byCategory.get('email')!.push(quickFindItem);
      }

      return {
        all,
        byCategory,
        users: byCategory.get('user') as QuickFindItem<'user'>[],
        channels: [
          ...(byCategory.get('channel') ?? []),
          ...(byCategory.get('dm') ?? []),
        ] as QuickFindItem<'channel' | 'dm'>[],
        items: [
          ...(byCategory.get('document') ?? []),
          ...(byCategory.get('note') ?? []),
          ...(byCategory.get('task') ?? []),
          ...(byCategory.get('chat') ?? []),
          ...(byCategory.get('folder') ?? []),
        ] as QuickFindItem<HistoryCategory>[],
        emails: byCategory.get('email') as QuickFindItem<'email'>[],
      };
    });

    // pre-compute mention entities format
    const mentionEntities = createMemo(() => {
      const c = collections();

      return {
        users: c.users.map((item) => ({
          kind: 'user' as const,
          id: item.id,
          data: item.data,
        })),
        items: c.items.map((item) => ({
          kind: 'item' as const,
          id: item.id,
          data: item.data as any,
        })),
        channels: c.channels.map((item) => ({
          kind: 'channel' as const,
          id: item.id,
          data: item.data,
        })),
        emails: c.emails.map((item) => ({
          kind: 'email' as const,
          id: item.id,
          data: item.data,
        })),
      };
    });

    const isLoading = () => historyQuery.isLoading || channelsLoading();

    return {
      collections,
      mentionEntities,
      isLoading,
    };
  }
);

export type { QuickFindContextValue } from './types';
