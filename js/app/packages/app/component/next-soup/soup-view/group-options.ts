import { SYSTEM_PROPERTY_IDS } from '@property/constants';

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

const GROUP_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'date', label: 'Date' },
  { value: 'entity_type', label: 'Type' },
  { value: 'project', label: 'Project' },
  { value: `property:${SYSTEM_PROPERTY_IDS.STATUS}`, label: 'Status' },
  { value: `property:${SYSTEM_PROPERTY_IDS.PRIORITY}`, label: 'Priority' },
  { value: `property:${SYSTEM_PROPERTY_IDS.ASSIGNEES}`, label: 'Assignee' },
  { value: 'project', label: 'Project' },
  { value: 'date', label: 'Date' },
] as const satisfies GroupOption[];

const buildGroupOptions = (keys: (typeof GROUP_OPTIONS)[number]['value'][]) => {
  const options = [];

  for (const key of keys) {
    const option = GROUP_OPTIONS.find((o) => o.value === key);

    if (!option) continue;

    options.push(option);
  }

  return options;
};

const _DEFAULT_GROUP_OPTIONS: GroupOption[] = [
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

const _EMAIL_GROUP_OPTIONS: GroupOption[] = [
  { value: 'none', label: 'None' },
  { value: 'date', label: 'Date' },
  { value: 'project', label: 'Project' },
];

const _INBOX_GROUP_OPTIONS: GroupOption[] = [
  { value: 'none', label: 'None' },
  { value: 'date', label: 'Date' },
  { value: 'entity_type', label: 'Type' },
  { value: 'project', label: 'Project' },
];
