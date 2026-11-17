import {
  type DatabaseCellValue,
  type DatabaseViewColumn,
  databaseCellValues,
} from '../../database/core/database-view';

/** A pipeline policy, expressed in stable editor identities. */
export type StageRequirement = {
  columnId: string;
  optionId: string;
  fields: string[];
};

/** Resolve stage identities from the shared editor's option labels. */
export function requiredStageFields(
  columns: DatabaseViewColumn[],
  rules: StageRequirement[],
  values: Record<string, DatabaseCellValue>
): DatabaseViewColumn[] {
  const required = new Set<string>();
  for (const rule of rules) {
    const stage = columns.find((column) => column.id === rule.columnId);
    const selected = stage?.options.find(
      (option) => option.label === values[rule.columnId]
    );
    if (selected?.id === rule.optionId)
      for (const id of rule.fields) required.add(id);
  }
  return columns.filter((column) => required.has(column.id));
}

/** Empty text and empty selections are absent; zero and false are values. */
export function missingStageFields(
  required: DatabaseViewColumn[],
  values: Record<string, DatabaseCellValue>
): DatabaseViewColumn[] {
  return required.filter((column) => {
    const entries = databaseCellValues(values[column.id] ?? null, column);
    return !entries.some(
      (value) =>
        value !== null && (typeof value !== 'string' || value.trim() !== '')
    );
  });
}
