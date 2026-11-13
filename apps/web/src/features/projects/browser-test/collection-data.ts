import {
  PROPERTY_OPTION_IDS,
  SYSTEM_PROPERTY_IDS,
} from '@property/identifiers';
import type { Property } from '@property/types';
import type { ProjectRow } from '../context/projects-context';

export const status: Property = {
  propertyId: 'status-value',
  propertyDefinitionId: SYSTEM_PROPERTY_IDS.STATUS,
  displayName: 'Status',
  isMultiSelect: false,
  owner: { scope: 'system' },
  createdAt: '',
  updatedAt: '',
  valueType: 'SELECT_STRING',
  value: null,
  options: [
    {
      id: 'open',
      value: { type: 'string', value: 'Open' },
      display_order: 0,
      color: null,
      property_definition_id: SYSTEM_PROPERTY_IDS.STATUS,
      created_at: '',
      updated_at: '',
    },
    {
      id: 'done',
      value: { type: 'string', value: 'Done' },
      display_order: 1,
      color: null,
      property_definition_id: SYSTEM_PROPERTY_IDS.STATUS,
      created_at: '',
      updated_at: '',
    },
  ],
};
export const priority: Property = {
  ...status,
  propertyId: 'priority-value',
  propertyDefinitionId: SYSTEM_PROPERTY_IDS.PRIORITY,
  displayName: 'Priority',
  options: [
    { id: PROPERTY_OPTION_IDS.PRIORITY.LOW, label: 'Low' },
    { id: PROPERTY_OPTION_IDS.PRIORITY.HIGH, label: 'High' },
  ].map(({ id, label }, index) => ({
    id,
    value: { type: 'string', value: label },
    display_order: index,
    color: null,
    property_definition_id: SYSTEM_PROPERTY_IDS.PRIORITY,
    created_at: '',
    updated_at: '',
  })),
};
export const rows: ProjectRow[] = [
  {
    project: {
      id: 'alpha',
      name: 'Alpha launch',
      access: 'owner',
      updatedAt: '2026-01-02T00:00:00Z',
      taskCount: 3,
      completedTaskCount: 1,
    },
    properties: [
      { ...status, value: ['open'] },
      { ...priority, value: [PROPERTY_OPTION_IDS.PRIORITY.LOW] },
    ],
  },
  {
    project: {
      id: 'beta',
      name: 'Beta review',
      access: 'owner',
      updatedAt: '2026-01-01T00:00:00Z',
      taskCount: 2,
      completedTaskCount: 2,
    },
    properties: [
      { ...status, value: ['done'] },
      { ...priority, value: [PROPERTY_OPTION_IDS.PRIORITY.HIGH] },
    ],
  },
];
