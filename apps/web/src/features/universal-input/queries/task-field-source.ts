import { defaultTaskPropertyValues } from '@app/features/block-md/util/taskComposerProperties';
import { useQuickAccess } from '@core/context/quickAccess';
import {
  getBuiltinPropertyIds,
  SYSTEM_PROPERTY_IDS,
} from '@property/constants';
import { useListPropertiesQuery } from '@queries/properties/definitions';
import type { PropertyDefinitionResponse } from '@service-properties/generated/schemas/propertyDefinitionResponse';
import { CUSTOMER_CONTACT_PROPERTY_IDS } from '../../task-composer/customer-contact';
import type { InputFields } from '../core/input';
import {
  parseTaskDate,
  suggestedTaskProperties,
  type TaskFieldDefinition,
  type TaskReference,
} from './suggested-task-properties';
import { parseTaskProperties } from './task-properties';

export function createTaskFieldSource(userId: string) {
  const query = useListPropertiesQuery(() => ({
    scope: 'system',
    includeOptions: true,
  }));
  // What extraction may suggest; Customer / Contact is only ever picked by hand.
  const allowed = new Set([
    ...getBuiltinPropertyIds('task'),
    SYSTEM_PROPERTY_IDS.PROJECT,
  ]);
  const creatable = new Set([...allowed, ...CUSTOMER_CONTACT_PROPERTY_IDS]);
  const items = useQuickAccess().useList(
    'person',
    'initiative',
    'task',
    'document'
  );
  const fromRows = (
    rows: PropertyDefinitionResponse[],
    ids: ReadonlySet<string> = allowed
  ): TaskFieldDefinition[] =>
    rows.flatMap((property) => {
      const definition =
        'definition' in property ? property.definition : property;
      if (!ids.has(definition.id)) return [];
      return [
        {
          definition,
          options:
            'property_options' in property ? property.property_options : [],
        },
      ];
    });
  const definitions = () => (query.isSuccess ? fromRows(query.data) : []);
  const loadRows = async () => {
    if (query.isSuccess) return query.data;
    const result = await query.refetch({ cancelRefetch: false });
    if (!result.isSuccess)
      throw result.error ?? new Error('Could not load task fields');
    return result.data;
  };
  const references = (): TaskReference[] =>
    items.items().map((item) =>
      item.kind === 'user'
        ? {
            id: item.id,
            type: 'USER',
            labels: [
              item.data.name ?? '',
              item.data.email,
              item.data.name?.split(' ')[0] ?? '',
            ].filter(Boolean),
          }
        : {
            id: item.id,
            type:
              item.bucket === 'initiative'
                ? 'INITIATIVE'
                : item.bucket === 'task'
                  ? 'TASK'
                  : 'DOCUMENT',
            labels: [item.data.name],
          }
    );
  return {
    definitions: async () =>
      fromRows(await loadRows())
        .filter(
          ({ definition }) => definition.id !== SYSTEM_PROPERTY_IDS.DUE_DATE
        )
        .map(({ definition, options }) => ({
          name: definition.display_name,
          options: options.map((option) => String(option.value.value)),
        })),
    createDefinitions: async () =>
      new Map(
        fromRows(await loadRows(), creatable).map(({ definition }) => [
          definition.id,
          definition,
        ])
      ),
    values: (fields: InputFields) => {
      const inferred = suggestedTaskProperties(
        fields.properties,
        definitions(),
        references()
      );
      const manual = parseTaskProperties(fields.taskProperties);
      const dueDate = fields.due_date
        ? parseTaskDate(fields.due_date)
        : undefined;
      return {
        values: {
          ...defaultTaskPropertyValues([userId]),
          ...inferred.values,
          ...(dueDate
            ? {
                [SYSTEM_PROPERTY_IDS.DUE_DATE]: {
                  valueType: 'DATE' as const,
                  value: dueDate,
                },
              }
            : {}),
          ...manual,
        },
        unresolved: [
          ...(fields.due_date &&
          !dueDate &&
          !manual[SYSTEM_PROPERTY_IDS.DUE_DATE]
            ? ['Due date']
            : []),
          ...inferred.unresolved.filter((name) => {
            const field = definitions().find(
              (f) =>
                f.definition.display_name.toLowerCase() === name.toLowerCase()
            );
            return !field || !manual[field.definition.id];
          }),
        ],
      };
    },
  };
}
