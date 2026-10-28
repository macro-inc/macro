import {
  agentFilter as agentPredicate,
  documentFilter as documentPredicate,
  emailFilter as emailPredicate,
  fileFilter as filePredicate,
  githubPrFilter as githubPrPredicate,
  peopleFilter as peoplePredicate,
  routineFilter as routinePredicate,
  taskFilter as taskPredicate,
  teamsFilter as teamsPredicate,
} from '../predicates';
import { config, isAgent, isEmail, isForeign, isTask } from './base';

const documentFilter = config({
  id: 'document',
  group: 'entity-type',
  predicate: documentPredicate,
  query: {
    include: { fileType: ['md', 'canvas', 'spreadsheet'] },
    exclude: { subType: ['task'] },
  },
});

const agentFilter = config({
  id: 'agent',
  group: 'entity-type',
  predicate: agentPredicate,
  query: isAgent,
});

const routineFilter = config({
  id: 'routine',
  group: 'entity-type',
  predicate: routinePredicate,
  query: {}, // No server query - routines are merged client-side via additionalEntities
});

const peopleFilter = config({
  id: 'people',
  group: 'entity-type',
  predicate: peoplePredicate,
  query: { include: { channelType: ['direct_message'] } },
});

const teamsFilter = config({
  id: 'teams',
  group: 'entity-type',
  predicate: teamsPredicate,
  query: { exclude: { channelType: ['direct_message'] } },
});

const taskFilter = config({
  id: 'task',
  group: 'entity-type',
  predicate: taskPredicate,
  query: isTask,
});

const emailFilter = config({
  id: 'email',
  group: 'entity-type',
  predicate: emailPredicate,
  query: isEmail,
});

const fileFilter = config({
  id: 'file',
  group: 'entity-type',
  predicate: filePredicate,
  query: {
    exclude: { fileType: ['md', 'canvas', 'spreadsheet'], subType: ['task'] },
  },
});

const githubPrFilter = config({
  id: 'github-pr',
  group: 'entity-type',
  predicate: githubPrPredicate,
  query: {
    ...isForeign,
    include: {
      foreignEntitySource: ['github_pull_request'],
    },
  },
});

export const ENTITY_TYPE_FILTERS = [
  documentFilter,
  agentFilter,
  routineFilter,
  peopleFilter,
  teamsFilter,
  taskFilter,
  emailFilter,
  fileFilter,
  githubPrFilter,
] as const;
