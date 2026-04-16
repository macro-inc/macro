import { getEntityProjectId } from '@entity';
import {
  channelsFilter as channelsPredicate,
  filesAndFolderFilter as filesAndFolderPredicate,
  projectFilter as projectPredicate,
  activeAgentFilter as activeAgentPredicate,
  taskFilter as taskPredicate,
  callsFilter as callsPredicate,
} from '../predicates';
import { config, isAgent, isNotTask, NIL } from './base';

export const channelsFilter = config({
  id: 'channels',
  predicate: channelsPredicate,
  query: { exclude: { channelId: [NIL] } },
});

export const filesAndFolderFilter = config({
  id: 'file-folder',
  predicate: filesAndFolderPredicate,
  query: { exclude: { fileType: ['md', 'canvas'], folderId: [NIL] } },
});

export const foldersFilter = config({
  id: 'folders',
  predicate: projectPredicate,
  query: { exclude: { folderId: [NIL] } },
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
  query: { exclude: { projectId: [NIL] } },
});

export const callsFilter = config({
  id: 'calls',
  predicate: callsPredicate,
  query: { exclude: { callChannelId: [NIL] } },
});
