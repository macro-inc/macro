import type { IUser } from '@core/user';
import type { DateValue } from '@core/util/date';
import type { CrmCompanyEntity, EntityData } from '@entity';
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
