import { SYSTEM_PROPERTY_IDS } from '@core/component/Properties/constants';

export type GroupOptionId =
  | 'none'
  | 'date'
  | 'entity_type'
  | 'project'
  | `property:${string}`;

export interface GroupOption {
  value: GroupOptionId;
  label: string;
}

export const GROUP_OPTIONS: GroupOption[] = [
  { value: 'none', label: 'None' },
  { value: 'date', label: 'Date' },
  { value: 'entity_type', label: 'Type' },
  { value: 'project', label: 'Project' },
];

export const DEFAULT_GROUP_OPTIONS: GroupOption[] = [
  { value: 'none', label: 'None' },
  { value: 'entity_type', label: 'Type' },
  { value: 'project', label: 'Project' },
];

export const TASK_GROUP_OPTIONS: GroupOption[] = [
  { value: 'none', label: 'None' },
  { value: `property:${SYSTEM_PROPERTY_IDS.STATUS}`, label: 'Status' },
  { value: `property:${SYSTEM_PROPERTY_IDS.PRIORITY}`, label: 'Priority' },
  { value: `property:${SYSTEM_PROPERTY_IDS.ASSIGNEES}`, label: 'Assignee' },
  { value: 'project', label: 'Project' },
  { value: 'date', label: 'Date' },
];

export const EMAIL_GROUP_OPTIONS: GroupOption[] = [
  { value: 'none', label: 'None' },
  { value: 'date', label: 'Date' },
  { value: 'project', label: 'Project' },
];

export const INBOX_GROUP_OPTIONS: GroupOption[] = [
  { value: 'none', label: 'None' },
  { value: 'date', label: 'Date' },
  { value: 'entity_type', label: 'Type' },
  { value: 'project', label: 'Project' },
];
