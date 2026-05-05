import type { GroupConfig, SoupEntity } from '@app/component/next-soup/create-soup-state';
import { isTaskEntity } from '@entity';
import {
  getTaskStatusOptionId,
  getTaskPriorityOptionId,
} from '@entity/utils/task-properties';
import type { TaskEntityWithProperties } from '@entity';
import { PROPERTY_OPTION_IDS } from '@core/component/Properties/constants';

// Status icons
import StatusCanceled from '@macro-icons/square/task-cancelled-circle.svg';
import StatusCreated from '@macro-icons/square/task-created-circle.svg';
import StatusDone from '@macro-icons/square/task-done-circle.svg';
import StatusInProgress from '@macro-icons/square/task-in-progress-circle.svg';
import StatusInReview from '@macro-icons/square/task-in-review-circle.svg';

// Priority icons
import PriorityHigh from '@macro-icons/wide/priority-high.svg';
import PriorityLow from '@macro-icons/wide/priority-low.svg';
import PriorityMedium from '@macro-icons/wide/priority-medium.svg';
import PriorityUrgent from '@macro-icons/wide/priority-urgent.svg';

export type GroupOptionId = 'type' | 'project' | 'status' | 'priority';

const TYPE_LABELS: Record<string, string> = {
  document: 'Documents',
  email: 'Emails',
  chat: 'Chats',
  channel: 'Channels',
  call: 'Calls',
  project: 'Projects',
  automation: 'Automations',
};

const STATUS_LABELS: Record<string, string> = {
  [PROPERTY_OPTION_IDS.STATUS.NOT_STARTED]: 'Not Started',
  [PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS]: 'In Progress',
  [PROPERTY_OPTION_IDS.STATUS.IN_REVIEW]: 'In Review',
  [PROPERTY_OPTION_IDS.STATUS.COMPLETED]: 'Completed',
  [PROPERTY_OPTION_IDS.STATUS.CANCELED]: 'Canceled',
};

const PRIORITY_LABELS: Record<string, string> = {
  [PROPERTY_OPTION_IDS.PRIORITY.URGENT]: 'Urgent',
  [PROPERTY_OPTION_IDS.PRIORITY.HIGH]: 'High',
  [PROPERTY_OPTION_IDS.PRIORITY.MEDIUM]: 'Medium',
  [PROPERTY_OPTION_IDS.PRIORITY.LOW]: 'Low',
};

// Status icon component
const StatusIcon = (props: { optionId: string }) => {
  switch (props.optionId) {
    case PROPERTY_OPTION_IDS.STATUS.NOT_STARTED:
      return <StatusCreated class="size-3 text-task" />;
    case PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS:
      return <StatusInProgress class="size-3 text-alert-ink" />;
    case PROPERTY_OPTION_IDS.STATUS.IN_REVIEW:
      return <StatusInReview class="size-3 text-note" />;
    case PROPERTY_OPTION_IDS.STATUS.COMPLETED:
      return <StatusDone class="size-3 text-accent" />;
    case PROPERTY_OPTION_IDS.STATUS.CANCELED:
      return <StatusCanceled class="size-3 text-ink-muted" />;
    default:
      return null;
  }
};

// Priority icon component
const PriorityIcon = (props: { optionId: string }) => {
  switch (props.optionId) {
    case PROPERTY_OPTION_IDS.PRIORITY.LOW:
      return <PriorityLow class="size-3 text-ink-extra-muted" />;
    case PROPERTY_OPTION_IDS.PRIORITY.MEDIUM:
      return <PriorityMedium class="size-3 text-ink-extra-muted" />;
    case PROPERTY_OPTION_IDS.PRIORITY.HIGH:
      return <PriorityHigh class="size-3 text-ink-extra-muted" />;
    case PROPERTY_OPTION_IDS.PRIORITY.URGENT:
      return <PriorityUrgent class="size-3 text-accent" />;
    default:
      return null;
  }
};

// Render header for status groups
const renderStatusHeader = (props: {
  value: unknown;
  label: string;
  count: number;
}) => {
  const optionId = props.value as string;
  const hasIcon =
    optionId !== 'non-task' && optionId !== 'none' && optionId in STATUS_LABELS;
  return (
    <span class="flex items-center gap-1.5">
      {hasIcon && <StatusIcon optionId={optionId} />}
      <span>{props.label}</span>
    </span>
  );
};

// Render header for priority groups
const renderPriorityHeader = (props: {
  value: unknown;
  label: string;
  count: number;
}) => {
  const optionId = props.value as string;
  const hasIcon =
    optionId !== 'non-task' &&
    optionId !== 'none' &&
    optionId in PRIORITY_LABELS;
  return (
    <span class="flex items-center gap-1.5">
      {hasIcon && <PriorityIcon optionId={optionId} />}
      <span>{props.label}</span>
    </span>
  );
};

export const GROUP_CONFIGS: Record<GroupOptionId, GroupConfig<SoupEntity>> = {
  type: {
    id: 'type',
    label: 'Type',
    getValue: (e) => e.type,
    getLabel: (v) => TYPE_LABELS[v as string] ?? String(v),
  },
  project: {
    id: 'project',
    label: 'Project',
    getValue: (e) => ('projectId' in e ? (e.projectId ?? 'none') : 'none'),
    getLabel: (v) => (v === 'none' ? 'No Project' : String(v)),
  },
  status: {
    id: 'status',
    label: 'Status',
    getValue: (e) => {
      if (!isTaskEntity(e)) return 'non-task';
      const statusId = getTaskStatusOptionId(e as TaskEntityWithProperties);
      return statusId ?? 'none';
    },
    getLabel: (v) => {
      if (v === 'non-task') return 'Non-Tasks';
      if (v === 'none') return 'No Status';
      return STATUS_LABELS[v as string] ?? String(v);
    },
    renderHeader: renderStatusHeader,
  },
  priority: {
    id: 'priority',
    label: 'Priority',
    getValue: (e) => {
      if (!isTaskEntity(e)) return 'non-task';
      const priorityId = getTaskPriorityOptionId(e as TaskEntityWithProperties);
      return priorityId ?? 'none';
    },
    getLabel: (v) => {
      if (v === 'non-task') return 'Non-Tasks';
      if (v === 'none') return 'No Priority';
      return PRIORITY_LABELS[v as string] ?? String(v);
    },
    renderHeader: renderPriorityHeader,
  },
};

export interface GroupOption {
  value: GroupOptionId | 'none';
  label: string;
}

export const GROUP_OPTIONS: GroupOption[] = [
  { value: 'none', label: 'None' },
  { value: 'type', label: 'Type' },
  { value: 'project', label: 'Project' },
  { value: 'status', label: 'Status' },
  { value: 'priority', label: 'Priority' },
];

export const TASK_GROUP_OPTIONS: GroupOption[] = [
  { value: 'none', label: 'None' },
  { value: 'status', label: 'Status' },
  { value: 'priority', label: 'Priority' },
  { value: 'project', label: 'Project' },
];

export const DEFAULT_GROUP_OPTIONS: GroupOption[] = [
  { value: 'none', label: 'None' },
  { value: 'type', label: 'Type' },
  { value: 'project', label: 'Project' },
];
