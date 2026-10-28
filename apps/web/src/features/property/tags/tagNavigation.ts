import type {
  PropertyFilter,
  Query,
} from '@app/features/next-soup/filters/filter-store';
import { getViewPreset } from '@app/features/next-soup/sidebar/soup-filter-presets';
import type {
  OpenWithSplitOptions,
  SplitContent,
} from '@components/app/split-layout/layoutManager';

export type TagNavigationTarget = {
  optionId: string;
  propertyDefinitionId: string;
};

export function tagToPropertyFilter(tag: TagNavigationTarget): PropertyFilter {
  return {
    propertyId: tag.propertyDefinitionId,
    type: 'select',
    value: tag.optionId,
  };
}

export function buildTaggedItemsQuery(tag: TagNavigationTarget): Query {
  const baseline = getViewPreset('search')?.filters ?? {};
  return {
    ...baseline,
    include: {
      ...baseline.include,
      tagFilters: [tagToPropertyFilter(tag)],
      tagFilterMode: 'any',
    },
    exclude: { ...baseline.exclude },
  };
}

export function buildTaggedItemsSplitContent(
  tag: TagNavigationTarget
): SplitContent {
  const searchPreset = getViewPreset('search');
  return {
    type: 'component',
    id: 'search',
    // Entry state outranks the user's persisted Search filters during Soup
    // initialization, so this explicit navigation always opens on the tag.
    state: {
      'search.filters': buildTaggedItemsQuery(tag),
      'search.predicates': searchPreset?.clientFilters,
    },
  };
}

export function buildTaggedItemsSplitOptions(
  options: Pick<OpenWithSplitOptions, 'handle'> = {}
): OpenWithSplitOptions {
  return {
    ...options,
    activate: true,
    allowDuplicate: true,
    preferNewSplit: true,
    referredFrom: null,
  };
}

export function navigateToTag(
  openWithSplit: (
    content: SplitContent,
    options?: OpenWithSplitOptions
  ) => unknown,
  tag: TagNavigationTarget,
  options: Pick<OpenWithSplitOptions, 'handle'> = {}
) {
  return openWithSplit(
    buildTaggedItemsSplitContent(tag),
    buildTaggedItemsSplitOptions(options)
  );
}
