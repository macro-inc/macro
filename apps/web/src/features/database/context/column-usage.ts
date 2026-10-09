import { createContext, useContext } from 'solid-js';
import type { FormsUsage } from '../core/forms-usage';

/** Which forms ask a column as a question, read once a deletion is weighed. */
export type ColumnUsage = {
  /** Start reading the forms' questions; until then usage is "checking". */
  prepare: () => void;
  usage: (columnId: string) => FormsUsage;
};

export const ColumnUsageContext = createContext<ColumnUsage>();

/** Where the grid knows who else reads its columns; absent in tests and embeds without forms. */
export function useColumnUsage(): ColumnUsage | undefined {
  return useContext(ColumnUsageContext);
}
