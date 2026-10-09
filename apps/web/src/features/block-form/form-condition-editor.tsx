/**
 * App adapter: a gate's rules, edited with the database grid's own filter
 * editor over the questions before the gate (RFC 02 §3).
 */

import { match } from 'ts-pattern';
import { FilterPanel } from '../database/components/database-view-filters';
import type { DatabaseViewColumn } from '../database/core/database-view';
import type { ConditionEditorProps } from './context/form-context';
import type { FormColumn } from './core/form-model';

export function toViewColumn(column: FormColumn): DatabaseViewColumn {
  const base = {
    id: column.id,
    name: column.name,
    options: column.options,
    writable: true,
  };
  return match(column.kind)
    .returnType<DatabaseViewColumn>()
    .with({ type: 'text' }, () => ({
      ...base,
      dataType: 'STRING',
      isMultiSelect: false,
    }))
    .with({ type: 'number' }, () => ({
      ...base,
      dataType: 'NUMBER',
      isMultiSelect: false,
    }))
    .with({ type: 'boolean' }, () => ({
      ...base,
      dataType: 'BOOLEAN',
      isMultiSelect: false,
    }))
    .with({ type: 'date' }, () => ({
      ...base,
      dataType: 'DATE',
      isMultiSelect: false,
    }))
    .with({ type: 'link' }, () => ({
      ...base,
      dataType: 'LINK',
      isMultiSelect: false,
    }))
    .with({ type: 'select' }, ({ multi }) => ({
      ...base,
      dataType: 'SELECT_STRING',
      isMultiSelect: multi,
    }))
    .with({ type: 'select_number' }, ({ multi }) => ({
      ...base,
      dataType: 'SELECT_NUMBER',
      isMultiSelect: multi,
    }))
    .with({ type: 'tag' }, () => ({
      ...base,
      dataType: 'TAG',
      isMultiSelect: true,
    }))
    .with({ type: 'entity' }, ({ target, multi }) => ({
      ...base,
      dataType: 'ENTITY',
      isMultiSelect: multi,
      specificEntityType: target,
    }))
    .with({ type: 'relation' }, ({ database, table }) => ({
      ...base,
      dataType: 'ENTITY',
      isMultiSelect: true,
      relation: { databaseId: database, tableId: table },
    }))
    .exhaustive();
}

/** Mounted once per open editor; its props are read live, so its draft survives saves. */
export function FormConditionEditor(props: ConditionEditorProps) {
  return (
    <FilterPanel
      columns={props.columns.map(toViewColumn)}
      filter={props.rules}
      onChange={props.onChange}
    />
  );
}
