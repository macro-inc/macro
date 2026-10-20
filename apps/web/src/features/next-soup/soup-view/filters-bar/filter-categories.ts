import type { FilterID } from '@app/features/next-soup/filters';
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
          // Getters, not a spread: a spread would freeze the translated
          // labels at the language active when this ran.
          id: category.id,
          get label() {
            return category.label;
          },
          get labelPlural() {
            return category.labelPlural;
          },
          multiple: category.multiple,
          options: category.options.filter(
            (option) => option.id !== 'github-pr'
          ),
        }
      : category
  );
}
