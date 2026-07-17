import type { IUser } from '@core/user';
import type { DateValue } from '@core/util/date';
import type { CrmCompanyEntity, EntityData } from '@entity';
import type { IndexedEntityItem } from '@graphql-cache/index';
import { formatDocumentName } from '@service-storage/util/filename';
import { toDate } from 'date-fns';
import type { EntityBucket, EntityItem, UserItem } from './types';

export function getGraphqlEntityBucket(
  entity: EntityData
): EntityBucket | undefined {
  switch (entity.type) {
    case 'document':
      if (entity.subType?.type === 'task') return 'task';
      if (entity.subType?.type === 'snippet') return 'snippet';
      return entity.fileType === 'md' ? 'note' : 'document';
    case 'channel':
      return entity.channelType === 'direct_message' ? 'dm' : 'channel';
    case 'chat':
      return 'chat';
    case 'project':
      return 'project';
    case 'email':
      return 'email';
    case 'crm_company':
      return 'crm_company';
    default:
      return undefined;
  }
}

function toTimestamp(value: DateValue | null | undefined): number {
  if (value == null) return 0;
  return toDate(value).getTime();
}

function getCrmCompanySearchText(company: CrmCompanyEntity): string {
  const domains = company.domains.map((domain) => domain.domain).join(' ');
  return domains ? `${company.name} | ${domains}` : company.name;
}

function getEntitySearchText(entity: EntityData): string {
  return entity.type === 'crm_company'
    ? getCrmCompanySearchText(entity)
    : entity.name;
}

export function graphqlEntityToQuickAccessItem(
  entity: EntityData
): EntityItem | undefined {
  if ('deletedAt' in entity && entity.deletedAt) return undefined;

  const bucket = getGraphqlEntityBucket(entity);
  if (!bucket) return undefined;

  const data: EntityData =
    entity.type === 'document'
      ? {
          ...entity,
          name: formatDocumentName(entity.name, entity.fileType, {
            fullyQualifiedBlockName: true,
          }),
        }
      : entity;
  const sortValue =
    data.viewedAt ?? data.sortTs ?? data.updatedAt ?? data.createdAt;

  return {
    kind: 'entity',
    id: data.id,
    bucket,
    searchText: getEntitySearchText(data),
    sortTimestamp: toTimestamp(sortValue),
    timestamps: {
      viewedAt: data.viewedAt,
      updatedAt: data.updatedAt,
      createdAt: data.createdAt,
    },
    data,
  };
}

function snapshotString(
  snapshot: Record<string, unknown>,
  field: string
): string | undefined {
  const value = snapshot[field];
  return typeof value === 'string' ? value : undefined;
}

function snapshotBoolean(
  snapshot: Record<string, unknown>,
  field: string
): boolean | undefined {
  const value = snapshot[field];
  return typeof value === 'boolean' ? value : undefined;
}

function snapshotObject(
  snapshot: Record<string, unknown>,
  field: string
): Record<string, unknown> | undefined {
  const value = snapshot[field];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function indexedSnapshotToEntity(item: IndexedEntityItem): EntityData {
  const snapshot = item.entity;
  const nameField =
    item.bucket === 'document'
      ? 'documentName'
      : item.bucket === 'chat'
        ? 'chatName'
        : item.bucket === 'project'
          ? 'projectName'
          : item.bucket === 'email'
            ? 'emailName'
            : item.bucket === 'channel'
              ? 'channelName'
              : 'crmCompanyName';
  const name =
    snapshotString(snapshot, nameField) ??
    snapshotString(snapshot, 'name') ??
    '';
  const ownerId = snapshotString(snapshot, 'ownerId') ?? '';
  const base = {
    id: item.id,
    name,
    ownerId,
    createdAt: snapshotString(snapshot, 'createdAt'),
    updatedAt: snapshotString(snapshot, 'updatedAt'),
    viewedAt: snapshotString(snapshot, 'viewedAt'),
  };

  switch (item.bucket) {
    case 'document': {
      const subtype = snapshotObject(snapshot, 'subType');
      const subtypeKind = snapshotString(subtype ?? {}, 'kind')?.toLowerCase();
      const kind =
        subtypeKind === 'task' || subtypeKind === 'snippet'
          ? subtypeKind
          : undefined;
      return {
        ...base,
        type: 'document',
        fileType:
          snapshotString(snapshot, 'fileType') ?? (kind ? 'md' : undefined),
        projectId: snapshotString(snapshot, 'projectId'),
        subType: kind
          ? {
              type: kind,
              is_completed:
                kind === 'task'
                  ? snapshotBoolean(subtype ?? {}, 'isCompleted')
                  : undefined,
            }
          : undefined,
      } as EntityData;
    }
    case 'chat':
      return {
        ...base,
        type: 'chat',
        name: name || 'New Chat',
        projectId: snapshotString(snapshot, 'projectId'),
      };
    case 'project':
      return {
        ...base,
        type: 'project',
        name: name || 'New Project',
        projectId: snapshotString(snapshot, 'parentId'),
      };
    case 'channel': {
      const rawChannelType = snapshotString(
        snapshot,
        'channelType'
      )?.toLowerCase();
      const channelType = [
        'direct_message',
        'private',
        'public',
        'team',
      ].includes(rawChannelType ?? '')
        ? (rawChannelType as 'direct_message' | 'private' | 'public' | 'team')
        : 'public';
      return {
        ...base,
        type: 'channel',
        name: name || 'Unknown Channel',
        channelType,
        interactedAt: snapshotString(snapshot, 'interactedAt'),
      };
    }
    case 'email':
      return {
        ...base,
        type: 'email',
        name: name || 'Email Thread',
        isRead: snapshotBoolean(snapshot, 'isRead') ?? false,
        isDraft: snapshotBoolean(snapshot, 'isDraft') ?? false,
        isImportant: snapshotBoolean(snapshot, 'isImportant') ?? false,
        done: !(snapshotBoolean(snapshot, 'inboxVisible') ?? true),
        projectId: snapshotString(snapshot, 'projectId'),
        senderEmail: snapshotString(snapshot, 'senderEmail'),
        senderName: snapshotString(snapshot, 'senderName'),
        snippet: snapshotString(snapshot, 'snippet'),
        linkId: snapshotString(snapshot, 'linkId'),
        sortTs: snapshotString(snapshot, 'sortTs'),
      };
    case 'crm_company': {
      const domains = Array.isArray(snapshot.domains)
        ? snapshot.domains.filter(
            (domain): domain is string => typeof domain === 'string'
          )
        : [];
      const teamId =
        snapshotString(snapshot, 'crmTeamId') ??
        snapshotString(snapshot, 'teamId') ??
        ownerId;
      return {
        ...base,
        type: 'crm_company',
        name: name || domains[0] || 'Unknown Company',
        ownerId: teamId,
        teamId,
        description: snapshotString(snapshot, 'description'),
        emailSync: snapshotBoolean(snapshot, 'emailSync'),
        hidden: snapshotBoolean(snapshot, 'hidden') ?? false,
        domains: domains.map((domain) => ({
          id: `${item.id}:${domain}`,
          companyId: item.id,
          domain,
          createdAt: base.createdAt,
        })),
      };
    }
    default:
      throw new Error(`unsupported indexed entity bucket: ${item.bucket}`);
  }
}

export function indexedEntityToQuickAccessItem(
  indexedItem: IndexedEntityItem
): EntityItem | undefined {
  const item = graphqlEntityToQuickAccessItem(
    indexedSnapshotToEntity(indexedItem)
  );
  return item
    ? {
        ...item,
        sortTimestamp: indexedItem.sortTimestamp,
      }
    : undefined;
}

export function userToQuickAccessItem(user: IUser): UserItem {
  const searchText =
    user.name === user.email
      ? `${user.email} | ${user.email}`
      : `${user.name} | ${user.email}`;

  return {
    kind: 'user',
    id: user.id,
    bucket: 'person',
    searchText,
    sortTimestamp: toTimestamp(user.lastInteraction),
    timestamps: { lastInteraction: user.lastInteraction },
    data: user,
  };
}
