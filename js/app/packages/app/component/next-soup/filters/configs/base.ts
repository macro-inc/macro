import type { EntityData } from '@entity';
import type { NotificationSource } from '@notifications';
import type { PropertyFilter, Query } from '../filter-store';

export const NO_ASSIGNEE = 'NO_ASSIGNEE';

export const NIL_UUID = '00000000-0000-0000-0000-000000000000';

export const IMAGE_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'webp',
] as const;

// NOTE: inlined from the block-video definition to avoid circular dependency
export const VIDEO_EXTENSIONS = [
  'mp4',
  'mkv',
  'webm',
  'avi',
  'mov',
  'wmv',
  'mpg',
  'mpeg',
  'm4v',
  'flv',
  'f4v',
  'threegp',
] as const;

export const isEmail = { exclude: { threadId: [NIL_UUID] } };
export const isAgent = { exclude: { chatId: [NIL_UUID] } };
export const isTask = { include: { subType: ['task'] } };
export const isNotTask = { exclude: { subType: ['task'] } };
export const isEmailAttachment = { include: { isEmailAttachment: true } };
export const isChannel = { exclude: { channelId: [NIL_UUID] } };
export const isFolder = { exclude: { folderId: [NIL_UUID] } };

export type FilterContext = {
  userId?: string;
  notificationSource?: NotificationSource;
  assignees?: string[];
};

export type Predicate = (entity: EntityData, ctx: FilterContext) => boolean;

export type QueryInput = Query;
export type QueryFn = (ctx: FilterContext) => QueryInput;

export type FilterDefinition<TId extends string = string> = {
  id: TId;
  group?: string;
  predicate: Predicate;
  query: QueryInput | QueryFn;
};

export type FilterGroupConfig = { id: string; allowMultiple: boolean };

export function config<TId extends string>(opts: {
  id: TId;
  query: QueryInput | QueryFn;
  predicate: Predicate;
  group?: string;
}): FilterDefinition<TId> {
  return {
    id: opts.id,
    group: opts.group,
    predicate: opts.predicate,
    query: opts.query,
  };
}

export const propFilter = (
  propertyId: string,
  type: 'select' | 'entity',
  value: string
): PropertyFilter => ({
  propertyId,
  type,
  value,
});
