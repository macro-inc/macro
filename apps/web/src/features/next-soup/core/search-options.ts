import { PROPERTY_OPTION_IDS } from '../../property/identifiers';

export const TASK_STATUS_OPTIONS: { id: string; label: string }[] = [
  {
    id: PROPERTY_OPTION_IDS.STATUS.NOT_STARTED,
    label: 'Not Started',
  },
  {
    id: PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS,
    label: 'In Progress',
  },
  {
    id: PROPERTY_OPTION_IDS.STATUS.IN_REVIEW,
    label: 'In Review',
  },
  {
    id: PROPERTY_OPTION_IDS.STATUS.COMPLETED,
    label: 'Completed',
  },
  {
    id: PROPERTY_OPTION_IDS.STATUS.CANCELED,
    label: 'Canceled',
  },
];

export const TASK_PRIORITY_OPTIONS: { id: string; label: string }[] = [
  {
    id: PROPERTY_OPTION_IDS.PRIORITY.URGENT,
    label: 'Urgent',
  },
  {
    id: PROPERTY_OPTION_IDS.PRIORITY.HIGH,
    label: 'High',
  },
  {
    id: PROPERTY_OPTION_IDS.PRIORITY.MEDIUM,
    label: 'Medium',
  },
  {
    id: PROPERTY_OPTION_IDS.PRIORITY.LOW,
    label: 'Low',
  },
];
