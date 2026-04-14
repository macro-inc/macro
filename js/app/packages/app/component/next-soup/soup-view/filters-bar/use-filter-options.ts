import { batch, createMemo } from 'solid-js';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import type { FilterAst } from '@app/component/next-soup/filters';
import type { Option } from './filter-primitives';

type UseFilterOptionsConfig = {
  multiple?: boolean;
  /** Optional function to compute filter AST based on selected option values */
  getFilterAst?: (selectedIds: string[]) => FilterAst;
};

export const useFilterOptions = (
  options: Option[],
  config: UseFilterOptionsConfig = {}
) => {
  const { multiple = true, getFilterAst } = config;
  const { soup, filterAst } = useSoupView();

  const optionIds = options.map((opt) => opt.value);

  const active = createMemo(() =>
    options.filter((opt) => soup.filters.isActive(opt.value))
  );

  const onChange = (selected: Option[]) => {
    const selectedIds = multiple
      ? selected.map((opt) => opt.value)
      : selected.length > 0
        ? [selected[selected.length - 1].value]
        : [];

    batch(() => {
      // Get current AND filter IDs, remove options from this group, add newly selected to OR
      const currentAndIds = soup.filters.andFilters().map((f) => f.id);
      const currentOrIds = soup.filters.orFilters().map((f) => f.id);
      const newOrIds = [
        ...currentOrIds.filter((id) => !optionIds.includes(id)),
        ...selectedIds,
      ];
      soup.filters.set({ and: currentAndIds, or: newOrIds });

      if (getFilterAst) {
        filterAst.set(getFilterAst(selectedIds));
      }
    });
  };

  return { active, onChange };
};
