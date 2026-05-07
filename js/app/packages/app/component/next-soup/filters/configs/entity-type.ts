import {
  agentFilter as agentPredicate,
  automationFilter as automationPredicate,
  documentFilter as documentPredicate,
  emailFilter as emailPredicate,
  fileFilter as filePredicate,
  peopleFilter as peoplePredicate,
  taskFilter as taskPredicate,
  teamsFilter as teamsPredicate,
} from '../predicates';
import { config, isAgent, isEmail, isTask } from './base';

export const documentFilter = config({
  id: 'document',
  group: 'entity-type',
  predicate: documentPredicate,
  query: {
    include: { fileAssoc: ['assoc:md', 'assoc:canvas'] },
    exclude: { subType: ['task'] },
  },
});

export const agentFilter = config({
  id: 'agent',
  group: 'entity-type',
  predicate: agentPredicate,
  query: isAgent,
});

export const automationFilter = config({
  id: 'automation',
  group: 'entity-type',
  predicate: automationPredicate,
  query: {}, // No server query - automations are merged client-side via additionalEntities
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
  query: {
    exclude: { fileAssoc: ['assoc:md', 'assoc:canvas'], subType: ['task'] },
  },
});

export const ENTITY_TYPE_FILTERS = [
  documentFilter,
  agentFilter,
  automationFilter,
  peopleFilter,
  teamsFilter,
  taskFilter,
  emailFilter,
  fileFilter,
] as const;
