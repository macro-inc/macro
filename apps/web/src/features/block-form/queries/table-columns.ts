/** A database table's columns, as the builder knows them. */
import type { ColumnDetail } from '@service-storage/generated/schemas/columnDetail';
import { match } from 'ts-pattern';
import type {
  FormColumn,
  FormColumnKind,
  FormEntityKind,
} from '../core/form-model';

const ENTITY_KINDS: readonly FormEntityKind[] = [
  'USER',
  'DOCUMENT',
  'TASK',
  'COMPANY',
  'CONTACT',
  'CALL_RECORD',
  'CHANNEL',
  'CHAT',
  'PROJECT',
  'THREAD',
  'CALENDAR_EVENT',
  'INITIATIVE',
];

function entityKind(value: string | null): FormEntityKind | undefined {
  return ENTITY_KINDS.find((kind) => kind === value);
}

/** A column's kind as ops spell it; undefined for kinds a form cannot ask. */
export function columnKindOf(column: ColumnDetail): FormColumnKind | undefined {
  const definition = column.definition.definition;
  const multi = definition.is_multi_select;
  const config = column.column.config;
  return match(definition.data_type)
    .returnType<FormColumnKind | undefined>()
    .with('STRING', () => ({ type: 'text' }))
    .with('NUMBER', () => ({ type: 'number' }))
    .with('BOOLEAN', () => ({ type: 'boolean' }))
    .with('DATE', () => ({ type: 'date' }))
    .with('LINK', () => ({ type: 'link' }))
    .with('SELECT_STRING', () => ({ type: 'select', multi }))
    .with('SELECT_NUMBER', () => ({ type: 'select_number', multi }))
    .with('TAG', () => ({ type: 'tag' }))
    .with('ENTITY', () => {
      if (config?.kind === 'link')
        return {
          type: 'relation',
          database: config.database_id,
          table: config.table_id,
        };
      const target = entityKind(definition.specific_entity_type);
      return target ? { type: 'entity', target, multi } : undefined;
    })
    .exhaustive();
}

export function toFormColumn(column: ColumnDetail): FormColumn | undefined {
  const kind = columnKindOf(column);
  if (!kind) return undefined;
  return {
    id: column.column.id,
    name:
      column.column.display_name ?? column.definition.definition.display_name,
    kind,
    options: column.definition.property_options.map((option) => ({
      id: option.id,
      label: String(option.value.value),
      color: option.color,
    })),
  };
}
