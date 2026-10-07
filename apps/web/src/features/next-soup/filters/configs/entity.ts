export {
  crmCompanyActiveFilter,
  crmCompanyFilter,
  crmCompanyHiddenFilter,
} from '../../../crm/collection-filters';

import { getEntityProjectId } from '@entity';
import { defineQueryFilters } from '../filter-store/compile';
import {
  activeAgentFilter as activeAgentPredicate,
  calendarEventFilter as calendarEventPredicate,
  callsFilter as callsPredicate,
  channelsFilter as channelsPredicate,
  filesAndFolderFilter as filesAndFolderPredicate,
  projectFilter as projectPredicate,
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
    exclude: {
      fileType: ['md', 'canvas', 'spreadsheet'],
      folderId: [NIL_UUID],
    },
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
