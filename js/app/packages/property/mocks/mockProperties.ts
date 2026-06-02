import { PROPERTY_OPTION_IDS, SYSTEM_PROPERTY_IDS } from '@property/constants';
import type { Property, PropertyOption } from '@property/types';

const EPOCH = new Date(0).toISOString();
const now = new Date();

const systemOwner = { scope: 'system' } as const;
const userOwner = {
  scope: 'user',
  user_id: 'macro|current@example.com',
} as const;

const statusOptions: PropertyOption[] = [
  {
    id: PROPERTY_OPTION_IDS.STATUS.NOT_STARTED,
    property_definition_id: SYSTEM_PROPERTY_IDS.STATUS,
    value: { type: 'string', value: 'Not started' },
    display_order: 0,
    created_at: EPOCH,
    updated_at: EPOCH,
  },
  {
    id: PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS,
    property_definition_id: SYSTEM_PROPERTY_IDS.STATUS,
    value: { type: 'string', value: 'In progress' },
    display_order: 1,
    created_at: EPOCH,
    updated_at: EPOCH,
  },
  {
    id: PROPERTY_OPTION_IDS.STATUS.IN_REVIEW,
    property_definition_id: SYSTEM_PROPERTY_IDS.STATUS,
    value: { type: 'string', value: 'In review' },
    display_order: 2,
    created_at: EPOCH,
    updated_at: EPOCH,
  },
  {
    id: PROPERTY_OPTION_IDS.STATUS.COMPLETED,
    property_definition_id: SYSTEM_PROPERTY_IDS.STATUS,
    value: { type: 'string', value: 'Completed' },
    display_order: 3,
    created_at: EPOCH,
    updated_at: EPOCH,
  },
];

const priorityOptions: PropertyOption[] = [
  {
    id: PROPERTY_OPTION_IDS.PRIORITY.LOW,
    property_definition_id: SYSTEM_PROPERTY_IDS.PRIORITY,
    value: { type: 'string', value: 'Low' },
    display_order: 0,
    created_at: EPOCH,
    updated_at: EPOCH,
  },
  {
    id: PROPERTY_OPTION_IDS.PRIORITY.MEDIUM,
    property_definition_id: SYSTEM_PROPERTY_IDS.PRIORITY,
    value: { type: 'string', value: 'Medium' },
    display_order: 1,
    created_at: EPOCH,
    updated_at: EPOCH,
  },
  {
    id: PROPERTY_OPTION_IDS.PRIORITY.HIGH,
    property_definition_id: SYSTEM_PROPERTY_IDS.PRIORITY,
    value: { type: 'string', value: 'High' },
    display_order: 2,
    created_at: EPOCH,
    updated_at: EPOCH,
  },
  {
    id: PROPERTY_OPTION_IDS.PRIORITY.URGENT,
    property_definition_id: SYSTEM_PROPERTY_IDS.PRIORITY,
    value: { type: 'string', value: 'Urgent' },
    display_order: 3,
    created_at: EPOCH,
    updated_at: EPOCH,
  },
];

const MOCK_USER_IDS = [
  'macro|alex@example.com',
  'macro|sam@example.com',
  'macro|jordan@example.com',
] as const;

const base = {
  isMultiSelect: false,
  owner: userOwner,
  createdAt: now,
  updatedAt: now,
} as const;

/**
 * One property per valueType, each populated with a representative value.
 */
export const PROPERTIES_FILLED: Property[] = [
  {
    ...base,
    propertyId: 'mock-status',
    propertyDefinitionId: SYSTEM_PROPERTY_IDS.STATUS,
    displayName: 'Status',
    owner: systemOwner,
    isSystemProperty: true,
    isRequired: true,
    options: statusOptions,
    valueType: 'SELECT_STRING',
    value: [PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS],
  },
  {
    ...base,
    propertyId: 'mock-priority',
    propertyDefinitionId: SYSTEM_PROPERTY_IDS.PRIORITY,
    displayName: 'Priority',
    owner: systemOwner,
    isSystemProperty: true,
    options: priorityOptions,
    valueType: 'SELECT_STRING',
    value: [PROPERTY_OPTION_IDS.PRIORITY.HIGH],
  },
  {
    ...base,
    propertyId: 'mock-assignees',
    propertyDefinitionId: SYSTEM_PROPERTY_IDS.ASSIGNEES,
    displayName: 'Assignees',
    owner: systemOwner,
    isSystemProperty: true,
    isMultiSelect: true,
    specificEntityType: 'USER',
    valueType: 'ENTITY',
    value: [
      { entity_id: MOCK_USER_IDS[0], entity_type: 'USER' },
      { entity_id: MOCK_USER_IDS[1], entity_type: 'USER' },
    ],
  },
  {
    ...base,
    propertyId: 'mock-single-user',
    propertyDefinitionId: 'mock-def-single-user',
    displayName: 'Lead',
    specificEntityType: 'USER',
    valueType: 'ENTITY',
    value: [{ entity_id: MOCK_USER_IDS[0], entity_type: 'USER' }],
  },
  {
    ...base,
    propertyId: 'mock-string',
    propertyDefinitionId: 'mock-def-string',
    displayName: 'Codename',
    valueType: 'STRING',
    value: 'project-helios',
  },
  {
    ...base,
    propertyId: 'mock-number',
    propertyDefinitionId: 'mock-def-number',
    displayName: 'Story points',
    valueType: 'NUMBER',
    value: 8,
  },
  {
    ...base,
    propertyId: 'mock-boolean',
    propertyDefinitionId: 'mock-def-boolean',
    displayName: 'Blocked',
    valueType: 'BOOLEAN',
    value: true,
  },
  {
    ...base,
    propertyId: 'mock-date',
    propertyDefinitionId: SYSTEM_PROPERTY_IDS.DUE_DATE,
    displayName: 'Due date',
    valueType: 'DATE',
    value: new Date(now.getTime() + 1000 * 60 * 60 * 24 * 3),
  },
  {
    ...base,
    propertyId: 'mock-select-multi',
    propertyDefinitionId: 'mock-def-select-multi',
    displayName: 'Tags',
    isMultiSelect: true,
    options: priorityOptions,
    valueType: 'SELECT_STRING',
    value: [
      PROPERTY_OPTION_IDS.PRIORITY.LOW,
      PROPERTY_OPTION_IDS.PRIORITY.HIGH,
    ],
  },
  {
    ...base,
    propertyId: 'mock-select-number',
    propertyDefinitionId: 'mock-def-select-number',
    displayName: 'Tier',
    options: [
      {
        id: 'tier-1',
        property_definition_id: 'mock-def-select-number',
        value: { type: 'number', value: 1 },
        display_order: 0,
        created_at: EPOCH,
        updated_at: EPOCH,
      },
      {
        id: 'tier-2',
        property_definition_id: 'mock-def-select-number',
        value: { type: 'number', value: 2 },
        display_order: 1,
        created_at: EPOCH,
        updated_at: EPOCH,
      },
    ],
    valueType: 'SELECT_NUMBER',
    value: ['tier-2'],
  },
  {
    ...base,
    propertyId: 'mock-entity-docs',
    propertyDefinitionId: 'mock-def-entity-docs',
    displayName: 'Related docs',
    isMultiSelect: true,
    specificEntityType: 'DOCUMENT',
    valueType: 'ENTITY',
    value: [
      { entity_id: 'doc-1', entity_type: 'DOCUMENT' },
      { entity_id: 'doc-2', entity_type: 'DOCUMENT' },
      { entity_id: 'doc-3', entity_type: 'DOCUMENT' },
    ],
  },
  {
    ...base,
    propertyId: 'mock-link',
    propertyDefinitionId: 'mock-def-link',
    displayName: 'Links',
    isMultiSelect: true,
    valueType: 'LINK',
    value: ['https://macro.com', 'https://github.com'],
  },
];

/**
 * Empty-state variants — same definitions, value=null.
 */
export const PROPERTIES_EMPTY: Property[] = PROPERTIES_FILLED.map((p) =>
  withClearedValue(p, `${p.propertyId}-empty`)
);

/**
 * Read-only variants — canEdit=false should hide affordances; this just
 * marks them as metadata so the readOnly path is exercised too.
 */
export const PROPERTIES_METADATA: Property[] = PROPERTIES_FILLED.map((p) => ({
  ...p,
  propertyId: `${p.propertyId}-metadata`,
  isMetadata: true,
}));

function withClearedValue(p: Property, id: string): Property {
  const next = { ...p, propertyId: id };
  if (next.valueType === 'STRING') return { ...next, value: null };
  if (next.valueType === 'NUMBER') return { ...next, value: null };
  if (next.valueType === 'BOOLEAN') return { ...next, value: null };
  if (next.valueType === 'DATE') return { ...next, value: null };
  return { ...next, value: null };
}
