import type { SearchableOptionSourceFactory } from '@app/features/next-soup/soup-view/filters-bar/option-source';
import { useContactIdFilterSource } from '@queries/contacts/use-directory';
import { createContactFilterOptions } from './contact-filter-options';

/** App composition for ID-valued people facets. */
export const useContactFilterOptions: SearchableOptionSourceFactory = (
  selected,
  enabled
) =>
  createContactFilterOptions(
    useContactIdFilterSource(selected, enabled),
    selected
  );
