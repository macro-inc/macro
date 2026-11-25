import { searchTagOperator } from '@app/features/next-soup/core/search-operator-filters';
import type {
  OpenWithSplitOptions,
  SplitContent,
} from '@components/app/split-layout/layoutManager';

export type TagNavigationTarget = {
  optionId: string;
  propertyDefinitionId: string;
  label: string;
};

/**
 * Search, opened on the items carrying `tag`: its query names the tag, bound
 * to the tag's id so any name reaches it.
 */
export function buildTaggedItemsSplitContent(
  tag: TagNavigationTarget
): SplitContent {
  const { text, bindings } = searchTagOperator({
    label: tag.label,
    propertyId: tag.propertyDefinitionId,
    optionId: tag.optionId,
  });
  return {
    type: 'component',
    id: 'search',
    state: { 'search.text': text, 'search.bindings': bindings },
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
