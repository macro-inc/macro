import {
  PROPERTY_OPTION_IDS,
  SYSTEM_PROPERTY_IDS,
} from '@property/identifiers';
import type { PropertyDefinition } from '@service-properties/generated/schemas/propertyDefinition';
import type { PropertyDefinitionWithOptions } from '@service-properties/generated/schemas/propertyDefinitionWithOptions';
import { expect, it } from 'vitest';
import { projectDefinitionProperties } from './project-properties';

const definition = (
  id: string,
  name: string,
  type: PropertyDefinition['data_type']
): PropertyDefinition => ({
  id,
  display_name: name,
  data_type: type,
  created_at: '',
  updated_at: '',
  is_system: true,
  is_metadata: false,
  is_multi_select: false,
  owner: { scope: 'system' },
});

it('orders composer properties like tasks while preserving supported status and priority options', () => {
  const status = definition(
    SYSTEM_PROPERTY_IDS.STATUS,
    'Status',
    'SELECT_STRING'
  );
  const priority = definition(
    SYSTEM_PROPERTY_IDS.PRIORITY,
    'Priority',
    'SELECT_STRING'
  );
  const withOption = (
    definition: PropertyDefinition
  ): PropertyDefinitionWithOptions => ({
    definition,
    property_options: [
      {
        id:
          definition.id === SYSTEM_PROPERTY_IDS.STATUS
            ? PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS
            : `${definition.id}-option`,
        property_definition_id: definition.id,
        value: { type: 'string', value: 'Choice' },
        display_order: 0,
        created_at: '',
        updated_at: '',
      },
    ],
  });
  const statusWithOption = withOption(status);
  const priorityWithOption = withOption(priority);
  const result = projectDefinitionProperties([
    definition(SYSTEM_PROPERTY_IDS.ASSIGNEES, 'Assignees', 'ENTITY'),
    definition(SYSTEM_PROPERTY_IDS.DUE_DATE, 'Due date', 'DATE'),
    priorityWithOption,
    statusWithOption,
    definition('unrelated', 'Other', 'STRING'),
  ]);
  expect(result.map((property) => property.displayName)).toEqual([
    'Status',
    'Priority',
    'Assignees',
    'Due date',
  ]);
  expect(result[0].options).toEqual(statusWithOption.property_options);
  expect(result[1].options).toEqual(priorityWithOption.property_options);
  expect(result.every((property) => property.value === null)).toBe(true);
});
