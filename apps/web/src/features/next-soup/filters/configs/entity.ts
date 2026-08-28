import { getEntityProjectId } from '@entity';
import { defineQueryFilters } from '../filter-store/compile';
import {
  activeAgentFilter as activeAgentPredicate,
  calendarEventFilter as calendarEventPredicate,
  callsFilter as callsPredicate,
  channelsFilter as channelsPredicate,
  crmCompanyActiveFilter as crmCompanyActivePredicate,
  crmCompanyHiddenFilter as crmCompanyHiddenPredicate,
  crmCompanyFilter as crmCompanyPredicate,
  doneRemindersFilter as doneRemindersPredicate,
  filesAndFolderFilter as filesAndFolderPredicate,
  firedRemindersFilter as firedRemindersPredicate,
  projectFilter as projectPredicate,
  remindersFilter as remindersPredicate,
  scheduledRemindersFilter as scheduledRemindersPredicate,
  searchSupportedFilter as searchSupportedPredicate,
  taskFilter as taskPredicate,
} from '../predicates';
import { config, isAgent, isNotTask, NIL_UUID } from './base';

export const channelsFilter = config({
  id: 'channels',
  predicate: channelsPredicate,
  query: { exclude: { channelId: [NIL_UUID] } },
});

export const filesAndFolderFilter = config({
  id: 'file-folder',
  predicate: filesAndFolderPredicate,
  query: {
    exclude: { fileAssoc: ['assoc:md', 'assoc:canvas'], folderId: [NIL_UUID] },
  },
});

export const foldersFilter = config({
  id: 'folders',
  predicate: projectPredicate,
  query: { exclude: { folderId: [NIL_UUID] } },
});

export const activeAgentFilter = config({
  id: 'active-agent',
  predicate: activeAgentPredicate,
  query: isAgent,
});

export const notTaskFilter = config({
  id: 'not-task',
  predicate: (e) => !taskPredicate(e),
  query: isNotTask,
});

export const documentOrFileFilter = config({
  id: 'document-or-file',
  predicate: (e) => e.type === 'document' && !taskPredicate(e),
  query: isNotTask,
});

export const inFolderFilter = config({
  id: 'in-folder',
  predicate: (e) => !!getEntityProjectId(e),
  query: { exclude: { projectId: [NIL_UUID] } },
});

export const callsFilter = config({
  id: 'calls',
  predicate: callsPredicate,
  query: defineQueryFilters({}, { skipTargets: ['callf'] }),
});

// Calendar events are searchable by title. Scoping to them alone means
// NIL-excluding every other entity type's id target while leaving `calf`
// untouched, which is exactly what skipping `calf` produces.
export const calendarFilter = config({
  id: 'calendar',
  predicate: calendarEventPredicate,
  query: defineQueryFilters({}, { skipTargets: ['calf'] }),
});

export const crmCompanyFilter = config({
  id: 'crm-company',
  predicate: crmCompanyPredicate,
  query: defineQueryFilters({}, { skipTargets: ['ccf'] }),
});

// Reminders are opt-in server-side, so unlike the other entity filters these
// queries name `includeReminders` rather than just skipping their own target —
// there is no `remf` entry in ID_FIELD_NAMES to skip.
export const remindersFilter = config({
  id: 'reminders',
  predicate: remindersPredicate,
  query: defineQueryFilters({ include: { includeReminders: true } }),
});

// `reminderCompleted: false` is load-bearing beyond the filtering: it is what
// `soupQueryExcludesDone` matches on (as `"comp":false`) to drop a reminder
// from these views the moment it is marked done, rather than on the next
// refetch. `reminderFired` is resolved server-side against the database clock
// — a client timestamp would land in the query key and change every render.
export const firedRemindersFilter = config({
  id: 'reminders-fired',
  predicate: firedRemindersPredicate,
  query: defineQueryFilters({
    include: {
      includeReminders: true,
      reminderCompleted: false,
      reminderFired: true,
    },
  }),
});

export const scheduledRemindersFilter = config({
  id: 'reminders-scheduled',
  predicate: scheduledRemindersPredicate,
  query: defineQueryFilters({
    include: {
      includeReminders: true,
      reminderCompleted: false,
      reminderFired: false,
    },
  }),
});

export const doneRemindersFilter = config({
  id: 'reminders-done',
  predicate: doneRemindersPredicate,
  query: defineQueryFilters({
    include: { includeReminders: true, reminderCompleted: true },
  }),
});

export const crmCompanyActiveFilter = config({
  id: 'crm-company-active',
  predicate: crmCompanyActivePredicate,
  query: defineQueryFilters(
    { include: { crmCompanyHidden: false } },
    { skipTargets: ['ccf'] }
  ),
});

export const crmCompanyHiddenFilter = config({
  id: 'crm-company-hidden',
  predicate: crmCompanyHiddenPredicate,
  query: defineQueryFilters(
    { include: { crmCompanyHidden: true } },
    { skipTargets: ['ccf'] }
  ),
});

export const searchSupportedFilter = config({
  id: 'search-supported',
  predicate: searchSupportedPredicate,
  query: {
    include: {
      foreignEntityRecordId: [NIL_UUID],
      crmCompanyId: [NIL_UUID],
      channelThreadId: [NIL_UUID],
    },
  },
});
