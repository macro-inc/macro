import type { FilterID } from '@app/component/next-soup/filters';
import type { JSX } from 'solid-js';

export type FilterOption = {
  id: FilterID;
  label: string;
  icon?: () => JSX.Element;
};

export type FilterCategory = {
  id: string;
  label: string;
  /** Plural form for multi-value chip display (e.g., 'Types', 'Statuses') */
  labelPlural?: string;
  options: FilterOption[];
  multiple?: boolean;
};

export function filterInboxGithubPrOption(
  categories: FilterCategory[],
  hasGithub: boolean
): FilterCategory[] {
  if (hasGithub) return categories;

  return categories.map((category) =>
    category.id === 'type'
      ? {
          ...category,
          options: category.options.filter(
            (option) => option.id !== 'github-pr'
          ),
        }
      : category
  );
}
