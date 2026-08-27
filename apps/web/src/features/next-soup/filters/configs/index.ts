export type { FilterContext } from './base';
export * from './base';
export * from './company';
export * from './document';
export * from './email';
export * from './entity';
export * from './entity-type';

export * from './general';
export * from './task';

import type { FilterGroupConfig } from './base';
import { companyOwnerFilter, companyStageFilter } from './company';
import {
  DOCUMENT_CONTEXTUAL_FILTERS,
  emailAttachmentsFilter,
  FILE_TYPE_FILTERS,
} from './document';
import {
  attachmentDocumentFilter,
  attachmentImageFilter,
  attachmentPdfFilter,
  emailDraftsFilter,
  hasAttachmentFilter,
  hasCalendarInviteFilter,
  noDraftsFilter,
} from './email';
import {
  activeAgentFilter,
  calendarFilter,
  callsFilter,
  channelsFilter,
  crmCompanyActiveFilter,
  crmCompanyFilter,
  crmCompanyHiddenFilter,
  documentOrFileFilter,
  doneRemindersFilter,
  filesAndFolderFilter,
  firedRemindersFilter,
  foldersFilter,
  inFolderFilter,
  notTaskFilter,
  remindersFilter,
  scheduledRemindersFilter,
  searchSupportedFilter,
} from './entity';
import { ENTITY_TYPE_FILTERS } from './entity-type';
import {
  doneFilter,
  explicitNoiseFilterDef,
  inboxFilter,
  noiseFilterDef,
  notDoneFilter,
  ownedEntityFilter,
  readFilter,
  sharedEntityFilter,
  unreadFilter,
} from './general';
import {
  activeTaskFilter,
  assignedToMeFilter,
  assigneeFilter,
  myTasksFilter,
  TASK_PRIORITY_FILTERS,
  TASK_STATUS_FILTERS,
} from './task';

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
  myTasksFilter,
  notTaskFilter,
  documentOrFileFilter,
  activeTaskFilter,
  calendarFilter,
  callsFilter,
  crmCompanyFilter,
  crmCompanyActiveFilter,
  crmCompanyHiddenFilter,
  companyOwnerFilter,
  companyStageFilter,
  emailAttachmentsFilter,
  inFolderFilter,
  remindersFilter,
  firedRemindersFilter,
  scheduledRemindersFilter,
  doneRemindersFilter,
  searchSupportedFilter,
  ...ENTITY_TYPE_FILTERS,
  ...TASK_STATUS_FILTERS,
  ...TASK_PRIORITY_FILTERS,
  ...DOCUMENT_CONTEXTUAL_FILTERS,
  ...FILE_TYPE_FILTERS,
] as const;

const _SOUP_FILTER_GROUPS: FilterGroupConfig[] = [
  { id: 'focus', allowMultiple: false },
  { id: 'entity-type', allowMultiple: true },
];

export type FilterID = (typeof SOUP_FILTERS)[number]['id'];
