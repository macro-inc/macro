import {
  clause,
  type Facet,
  type FacetClause,
  type FacetOption,
  NIL_UUID,
} from '@app/features/soup';
import {
  type EntityData,
  isGithubPrEntity,
  isTaskEntity,
} from '@entity/types/entity';
import { isWithNotification } from '@entity/types/notification';
import { toNotificationEntity } from '@entity/utils/notification';
import type { NotificationSource } from '@notifications/notification-source';
import { compositeEntity } from '@notifications/types';
import type { InboxReadFilter, InboxTypeFilter } from './types';

export type InboxFacetContext = {
  notificationSource?: NotificationSource;
};

export type InboxFacetOption = FacetOption<EntityData, InboxFacetContext> & {
  label: string;
};

function readClause(seen: boolean): FacetClause {
  return {
    df: clause.eq('documentSeen', seen),
    calf: clause.eq('calendarEventSeen', seen),
    ef: clause.eq('emailSeen', seen),
    chanf: clause.eq('channelSeen', seen),
    cthf: clause.eq('channelThreadSeen', seen),
    cf: clause.eq('chatSeen', seen),
    pf: clause.eq('folderSeen', seen),
    fef: clause.eq('foreignEntitySeen', seen),
  };
}

function readOption(
  id: InboxReadFilter,
  label: string,
  seen: boolean
): InboxFacetOption {
  return {
    id,
    label,
    clause: readClause(seen),
    predicate: (entity, context) => {
      const source = context.notificationSource;
      if (!source) return true;

      if (entity.type === 'email') {
        const unread = !entity.isRead;
        return unread !== seen;
      }

      const notifications =
        (isWithNotification(entity)
          ? entity.notifications?.()
          : source.notificationsByEntity()[
              compositeEntity(toNotificationEntity(entity))
            ]) ?? [];
      const unread = notifications.some(
        (notification) => !notification.viewed_at
      );

      return unread !== seen;
    },
  };
}

const typeOptions: Record<InboxTypeFilter, InboxFacetOption> = {
  documents: {
    id: 'documents',
    label: 'Documents',
    clause: {
      df: clause.not(clause.eq('subType', 'task')),
    },
    predicate: (entity) => entity.type === 'document' && !isTaskEntity(entity),
  },
  tasks: {
    id: 'tasks',
    label: 'Tasks',
    clause: { df: clause.eq('subType', 'task') },
    predicate: isTaskEntity,
  },
  email: {
    id: 'email',
    label: 'Email',
    clause: { ef: clause.not(clause.eq('threadId', NIL_UUID)) },
    predicate: (entity) => entity.type === 'email',
  },
  channels: {
    id: 'channels',
    label: 'Channels',
    clause: {
      chanf: clause.not(clause.eq('channelId', NIL_UUID)),
      cthf: clause.not(clause.eq('channelThreadId', NIL_UUID)),
    },
    predicate: (entity) =>
      entity.type === 'channel' ||
      entity.type === 'channel_message' ||
      entity.type === 'channel_thread',
  },
  agents: {
    id: 'agents',
    label: 'Agents',
    clause: { cf: clause.not(clause.eq('chatId', NIL_UUID)) },
    predicate: (entity) => entity.type === 'chat',
  },
  projects: {
    id: 'projects',
    label: 'Projects',
    clause: { pf: clause.not(clause.eq('folderId', NIL_UUID)) },
    predicate: (entity) => entity.type === 'project',
  },
  github: {
    id: 'github',
    label: 'GitHub',
    clause: {
      fef: clause.not(clause.eq('foreignEntityRecordId', NIL_UUID)),
    },
    predicate: isGithubPrEntity,
  },
  reminders: {
    id: 'reminders',
    label: 'Reminders',
    clause: { remf: clause.not(clause.eq('reminderId', NIL_UUID)) },
    predicate: (entity) => entity.type === 'reminder',
  },
  calendar: {
    id: 'calendar',
    label: 'Calendar',
    clause: {
      calf: clause.not(clause.eq('calendarEventId', NIL_UUID)),
    },
    predicate: (entity) => entity.type === 'calendar_event',
  },
};

type InboxFilterGroup = {
  id: string;
  label: string;
  selectionMode?: 'single' | 'multiple';
  defaultOptionId?: string;
  options: { id: string; label: string }[];
};

export const INBOX_FILTER_GROUPS: InboxFilterGroup[] = [
  {
    id: 'read',
    label: 'Status',
    selectionMode: 'single',
    defaultOptionId: 'all',
    options: [
      { id: 'unread', label: 'Unread' },
      { id: 'read', label: 'Read' },
      { id: 'all', label: 'All' },
    ],
  },
  {
    id: 'type',
    label: 'Type',
    options: Object.values(typeOptions),
  },
];

export const INBOX_FACETS: Facet<
  EntityData,
  InboxFacetContext,
  InboxFacetOption
>[] = [
  {
    id: 'read',
    mode: 'or',
    options: [
      readOption('unread', 'Unread', false),
      readOption('read', 'Read', true),
    ],
  },
  {
    id: 'type',
    mode: 'or',
    restrict: true,
    options: Object.values(typeOptions),
  },
];
