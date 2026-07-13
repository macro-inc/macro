import { LIST_VIEW_ID } from '@app/constants/list-views';
import {
  type PropertyFilter,
  type Query,
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

export function tagToPropertyFilter(
  tag: TagNavigationTarget
): PropertyFilter {
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
  return {
    type: 'component',
    id: LIST_VIEW_ID.search,
    params: {
      initialFilters: buildTaggedItemsQuery(tag),
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
    referredFrom: LIST_VIEW_ID.search,
  };
}
