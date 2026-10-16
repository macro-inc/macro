import type {
  SoupApiItem,
  SoupProperty,
} from '../../../generated/storage/types.gen';
import type { MacroClient } from '../../utils/client';
import { CalendarEvent } from '../calendar/event';
import { CallRecord } from '../calls/call-record';
import { Channel } from '../channels/channel';
import { Thread } from '../channels/thread';
import { Chat } from '../chats/chat';
import { Document } from '../documents/document';
import { EmailThread } from '../email/thread';
import { ForeignEntity } from '../foreign/foreign-entity';
import { Project } from '../projects/project';
import type { WorkspaceItem, WorkspaceTag } from './types';

/** @internal */
export function properties(item: SoupApiItem): SoupProperty[] {
  if ('properties' in item.data) return item.data.properties;
  if (item.tag === 'calendarEvent') return item.data.extra.properties;
  return [];
}

/** @internal */
export function workspaceItem(
  client: MacroClient,
  item: SoupApiItem,
  tagMap: Map<string, WorkspaceTag>,
): WorkspaceItem {
  const tags: WorkspaceTag[] = [];
  for (const property of properties(item)) {
    if (
      property.definition.data_type !== 'TAG' ||
      property.value?.type !== 'SelectOption'
    )
      continue;
    for (const option of property.value.value) {
      const tag = tagMap.get(option);
      if (
        tag &&
        !tags.some(
          (existing) =>
            existing.label === tag.label && existing.scope === tag.scope,
        )
      )
        tags.push(tag);
    }
  }
  switch (item.tag) {
    case 'document':
      return {
        type: 'document',
        id: item.data.id,
        entity: Document.byId(client, item.data.id),
        snapshot: item,
        tags,
        name: item.data.name,
        fileType: item.data.fileType,
        subType: item.data.subType?.type,
      };
    case 'chat':
      return {
        type: 'ai_chat',
        id: item.data.id,
        entity: Chat.byId(client, item.data.id),
        snapshot: item,
        tags,
        name: item.data.name,
      };
    case 'project':
      return {
        type: 'project',
        id: item.data.id,
        entity: Project.byId(client, item.data.id),
        snapshot: item,
        tags,
        name: item.data.name,
      };
    case 'emailThread':
      return {
        type: 'email',
        id: item.data.id,
        entity: EmailThread.byId(client, item.data.id),
        snapshot: item,
        tags,
        subject: item.data.name,
        snippet: item.data.snippet,
        senderName: item.data.senderName,
        senderEmail: item.data.senderEmail,
        inboxVisible: item.data.inboxVisible,
        isRead: item.data.isRead,
        isDraft: item.data.isDraft,
      };
    case 'channel':
      return {
        type: 'channel',
        id: item.data.channel.id,
        entity: Channel.byId(client, item.data.channel.id),
        snapshot: item,
        tags,
        name: item.data.channel.name,
      };
    case 'channelThread':
      return {
        type: 'channel_thread',
        id: item.data.id,
        entity: new Thread(client, item.data.channel_id, item.data.id),
        snapshot: item,
        tags,
        channelId: item.data.channel_id,
      };
    case 'call':
      return {
        type: 'call',
        id: item.data.callId,
        entity: CallRecord.byId(client, item.data.callId),
        snapshot: item,
        tags,
        createdBy: item.data.createdBy,
      };
    case 'calendarEvent':
      return {
        type: 'calendar_event',
        id: item.data.id,
        entity: CalendarEvent.byId(client, item.data.id),
        snapshot: item,
        tags,
        title: item.data.title,
        status: item.data.status,
        location: item.data.location,
        conferenceUrl: item.data.conferenceUrl,
        conferenceProvider: item.data.conferenceProvider,
        time: item.data.time,
      };
    case 'foreignEntity':
      return {
        type: 'foreign_entity',
        id: item.data.id,
        entity: ForeignEntity.byId(client, item.data.id),
        snapshot: item,
        tags,
        foreignEntityId: item.data.foreignEntityId,
        foreignEntitySource: item.data.foreignEntitySource,
        metadata: item.data.metadata,
      };
    default:
      throw new Error(`Unexpected workspace entity type: ${item.tag}`);
  }
}
