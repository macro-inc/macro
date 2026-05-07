import { getEntityProjectId } from '@entity';
import { defineQueryFilters } from '../filter-store/compile';
import {
  activeAgentFilter as activeAgentPredicate,
  callsFilter as callsPredicate,
  channelsFilter as channelsPredicate,
  filesAndFolderFilter as filesAndFolderPredicate,
  projectFilter as projectPredicate,
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
