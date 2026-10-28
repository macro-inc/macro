import type { Accessor, Setter } from 'solid-js';
import {
  type CrmDisplayOptions,
  type CrmListColumnId,
  DEFAULT_CRM_DISPLAY_OPTIONS,
} from '../core/display-options';
export function createCrmDisplayOptions(
  currentOptions: Accessor<CrmDisplayOptions>,
  setOptions: Setter<CrmDisplayOptions>
) {
  // Merge with defaults so options saved by older builds keep working
  // when new fields are added.
  const merged = (): CrmDisplayOptions => ({
    listColumns: {
      ...DEFAULT_CRM_DISPLAY_OPTIONS.listColumns,
      ...currentOptions().listColumns,
    },
  });

  const toggleListColumn = (column: CrmListColumnId) => {
    const current = merged();
    setOptions({
      ...current,
      listColumns: {
        ...current.listColumns,
        [column]: !current.listColumns[column],
      },
    });
  };

  return { options: merged, toggleListColumn };
}
