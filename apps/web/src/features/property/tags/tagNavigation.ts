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

/** Search, opened on the items carrying `tag`, its query naming the tag. */
export function buildTaggedItemsSplitContent(
  tag: TagNavigationTarget
): SplitContent {
  return {
    type: 'component',
    id: 'search',
    state: { 'search.text': searchTagOperator(tag.label) },
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
