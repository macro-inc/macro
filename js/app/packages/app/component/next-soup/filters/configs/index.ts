export * from './base';
export * from './entity-type';
export * from './entity';
export * from './document';
export * from './email';
export * from './task';
export * from './general';

import { ENTITY_TYPE_FILTERS } from './entity-type';
import {
  channelsFilter,
  filesAndFolderFilter,
  foldersFilter,
  activeAgentFilter,
  notTaskFilter,
  documentOrFileFilter,
} from './entity';
import { DOCUMENT_CONTEXTUAL_FILTERS, FILE_TYPE_FILTERS } from './document';
import { TASK_STATUS_FILTERS, TASK_PRIORITY_FILTERS, activeTaskFilter, assignedToMeFilter, assigneeFilter } from './task';
import {
  emailDraftsFilter,
  noDraftsFilter,
  hasCalendarInviteFilter,
  hasAttachmentFilter,
  attachmentPdfFilter,
  attachmentImageFilter,
  attachmentDocumentFilter,
} from './email';
import {
  inboxFilter,
  noiseFilterDef,
  explicitNoiseFilterDef,
  unreadFilter,
  readFilter,
  notDoneFilter,
  doneFilter,
  sharedEntityFilter,
  ownedEntityFilter,
} from './general';
import type { FilterGroupConfig } from './base';

export const SOUP_FILTERS = [
  inboxFilter,
  noiseFilterDef,
  explicitNoiseFilterDef,
  unreadFilter,
  readFilter,
  notDoneFilter,
  doneFilter,
  channelsFilter,
  filesAndFolderFilter,
  foldersFilter,
  activeAgentFilter,
  emailDraftsFilter,
  noDraftsFilter,
  hasCalendarInviteFilter,
  hasAttachmentFilter,
  attachmentPdfFilter,
  attachmentImageFilter,
  attachmentDocumentFilter,
  sharedEntityFilter,
  ownedEntityFilter,
  assignedToMeFilter,
  assigneeFilter,
  notTaskFilter,
  documentOrFileFilter,
  activeTaskFilter,
  ...ENTITY_TYPE_FILTERS,
  ...TASK_STATUS_FILTERS,
  ...TASK_PRIORITY_FILTERS,
  ...DOCUMENT_CONTEXTUAL_FILTERS,
  ...FILE_TYPE_FILTERS,
] as const;

export const SOUP_FILTER_GROUPS: FilterGroupConfig[] = [
  { id: 'focus', allowMultiple: false },
  { id: 'entity-type', allowMultiple: true },
];

export type FilterID = (typeof SOUP_FILTERS)[number]['id'];
