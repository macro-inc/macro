/** Which forms write to the database's tables and ask its columns (RFC 02 §7). */
import {
  formDetailQueryOptions,
  useFormsForDatabaseQuery,
} from '@queries/storage/forms';
import type { FilterGroup } from '@service-storage/generated/schemas/filterGroup';
import { useQueries } from '@tanstack/solid-query';
import { type Accessor, createSignal } from 'solid-js';
import type { ColumnUsage } from '../../database/context/column-usage';
import type { FormsUsage } from '../../database/core/forms-usage';

type ListRead = ReturnType<typeof useFormsForDatabaseQuery>;

/** Whether a gate's rules, nested groups included, test the column. */
function rulesName(rules: FilterGroup, columnId: string): boolean {
  return rules.conditions.some((node) =>
    node.kind === 'group' ? rulesName(node, columnId) : node.column === columnId
  );
}

/** The list's state as usage, while it has no answer. */
function listUsage(forms: ListRead): FormsUsage | undefined {
  if (forms.isSuccess) return undefined;
  if (forms.isError) return { kind: 'unknown' };
  return { kind: 'checking' };
}

/** The forms writing to each table, for the delete-table confirmation. */
export function useFormsOverTables(
  databaseId: Accessor<string>
): (tableId: string) => FormsUsage {
  const forms = useFormsForDatabaseQuery(databaseId);
  return (tableId) =>
    listUsage(forms) ?? {
      kind: 'known',
      gated: [],
      names: forms.isSuccess
        ? forms.data
            .filter((form) => form.tableId === tableId)
            .map((form) => form.name)
        : [],
    };
}

/**
 * The forms asking each column. Their questions are read only once a column
 * deletion is weighed (`prepare`), not with every grid.
 */
export function useFormsAskingColumns(
  databaseId: Accessor<string>
): ColumnUsage {
  const forms = useFormsForDatabaseQuery(databaseId);
  const [wanted, setWanted] = createSignal(false);
  const details = useQueries(() => ({
    queries: (forms.isSuccess && wanted() ? forms.data : []).map((form) => ({
      ...formDetailQueryOptions(form.id),
      throwOnError: false,
      retry: false,
    })),
  }));
  return {
    prepare: () => setWanted(true),
    usage: (columnId) => {
      const fromList = listUsage(forms);
      if (fromList) return fromList;
      if (!forms.isSuccess || forms.data.length === 0)
        return { kind: 'known', names: [], gated: [] };
      if (!wanted() || details.some((query) => query.isPending))
        return { kind: 'checking' };
      if (details.some((query) => query.isError)) return { kind: 'unknown' };
      const read = details.flatMap((query) =>
        query.isSuccess ? [query.data] : []
      );
      return {
        kind: 'known',
        names: read
          .filter((form) =>
            form.sections.some(
              (section) =>
                section.kind === 'questions' &&
                section.questions.some(
                  (question) => question.column === columnId
                )
            )
          )
          .map((form) => form.form.name),
        gated: read
          .filter((form) =>
            form.sections.some(
              (section) =>
                section.kind === 'gate' && rulesName(section.rules, columnId)
            )
          )
          .map((form) => form.form.name),
      };
    },
  };
}
