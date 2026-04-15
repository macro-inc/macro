import {
  documentFilter as documentPredicate,
  taskFilter as taskPredicate,
  emailFilter as emailPredicate,
  peopleFilter as peoplePredicate,
  teamsFilter as teamsPredicate,
  agentFilter as agentPredicate,
  fileFilter as filePredicate,
} from '../predicates';
import { config, isAgent, isEmail, isTask, NIL } from './base';


export const documentFilter = config({
  id: 'document',
  group: 'entity-type',
  predicate: documentPredicate,
  query: {
    include: { fileType: ['md', 'canvas'] },
    exclude: { subType: ['task'] },
  },
});

export const agentFilter = config({
  id: 'agent',
  group: 'entity-type',
  predicate: agentPredicate,
  query: isAgent,
});

export const peopleFilter = config({
  id: 'people',
  group: 'entity-type',
  predicate: peoplePredicate,
  query: { include: { channelType: ['direct_message'] } },
});

export const teamsFilter = config({
  id: 'teams',
  group: 'entity-type',
  predicate: teamsPredicate,
  query: { exclude: { channelType: ['direct_message'] } },
});

export const taskFilter = config({
  id: 'task',
  group: 'entity-type',
  predicate: taskPredicate,
  query: isTask,
});

export const emailFilter = config({
  id: 'email',
  group: 'entity-type',
  predicate: emailPredicate,
  query: isEmail,
});

export const fileFilter = config({
  id: 'file',
  group: 'entity-type',
  predicate: filePredicate,
  query: { exclude: { fileType: ['md', 'canvas'], subType: ['task'] } },
});

/**
 * Channels marked as important/recent.
 * Server-side only: `importance` is not available on client channel entity.
 */
export const recentChannelsFilter = config({
  id: 'recent-channels',
  predicate: (e) => e.type === 'channel' || e.type === 'channel_message',
  query: { include: { channelImportance: [true] } },
});

export const ENTITY_TYPE_FILTERS = [
  documentFilter,
  agentFilter,
  peopleFilter,
  teamsFilter,
  taskFilter,
  emailFilter,
  fileFilter,
  recentChannelsFilter,
] as const;
