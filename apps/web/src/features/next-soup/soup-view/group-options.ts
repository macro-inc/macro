import { type TranslationKey, t } from '@app/lib/i18n';
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

/** A group option whose label is translated each time it renders. */
const groupOption = <TValue extends GroupOptionId>(
  value: TValue,
  key: TranslationKey
): { value: TValue; readonly label: string } => ({
  value,
  get label() {
    return t(key);
  },
});

const GROUP_OPTIONS = [
  groupOption('none', 'viewMenus.groupNone'),
  groupOption('date', 'viewMenus.date'),
  groupOption('entity_type', 'viewMenus.type'),
  groupOption('project', 'viewMenus.project'),
  groupOption(`property:${SYSTEM_PROPERTY_IDS.STATUS}`, 'viewMenus.status'),
  groupOption(`property:${SYSTEM_PROPERTY_IDS.PRIORITY}`, 'viewMenus.priority'),
  groupOption(
    `property:${SYSTEM_PROPERTY_IDS.ASSIGNEES}`,
    'viewMenus.assignee'
  ),
  groupOption('project', 'viewMenus.project'),
  groupOption('date', 'viewMenus.date'),
] as const satisfies GroupOption[];

const _buildGroupOptions = (
  keys: (typeof GROUP_OPTIONS)[number]['value'][]
) => {
  const options = [];

  for (const key of keys) {
    const option = GROUP_OPTIONS.find((o) => o.value === key);

    if (!option) continue;

    options.push(option);
  }

  return options;
};

const _DEFAULT_GROUP_OPTIONS: GroupOption[] = [
  groupOption('none', 'viewMenus.groupNone'),
  groupOption('entity_type', 'viewMenus.type'),
  groupOption('project', 'viewMenus.project'),
];

export const TASK_GROUP_OPTIONS: GroupOption[] = [
  groupOption('none', 'viewMenus.groupNone'),
  groupOption(`property:${SYSTEM_PROPERTY_IDS.STATUS}`, 'viewMenus.status'),
  groupOption(`property:${SYSTEM_PROPERTY_IDS.PRIORITY}`, 'viewMenus.priority'),
  groupOption(
    `property:${SYSTEM_PROPERTY_IDS.ASSIGNEES}`,
    'viewMenus.assignee'
  ),
  groupOption('project', 'viewMenus.project'),
  groupOption('date', 'viewMenus.date'),
];

export const TAG_VIEW_GROUP_OPTIONS: GroupOption[] = [
  groupOption('none', 'viewMenus.groupNone'),
  groupOption('entity_type', 'viewMenus.type'),
  groupOption('project', 'viewMenus.project'),
  groupOption('date', 'viewMenus.date'),
];

const _EMAIL_GROUP_OPTIONS: GroupOption[] = [
  groupOption('none', 'viewMenus.groupNone'),
  groupOption('date', 'viewMenus.date'),
  groupOption('project', 'viewMenus.project'),
];

const _INBOX_GROUP_OPTIONS: GroupOption[] = [
  groupOption('none', 'viewMenus.groupNone'),
  groupOption('date', 'viewMenus.date'),
  groupOption('entity_type', 'viewMenus.type'),
  groupOption('project', 'viewMenus.project'),
];
