import type { ExpandedEntityType } from '@macro-entity';
import type { DocumentTypeFilter } from '../../ViewConfig';

/**
 * Pure helper for set equality comparison.
 */
export const sameSet = <T>(a: readonly T[], b: readonly T[]): boolean => {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  return b.every((x) => setA.has(x));
};

/**
 * Pure predicate: is a specific document preset filter active?
 * Checks if typeFilter is exactly ['document'] and documentTypeFilter matches targetTypes.
 */
export const isDocumentPresetActive = (
  typeFilter: readonly ExpandedEntityType[],
  documentTypeFilter: readonly DocumentTypeFilter[],
  targetTypes: readonly DocumentTypeFilter[]
): boolean => {
  if (typeFilter.length !== 1 || typeFilter[0] !== 'document') return false;
  return sameSet(documentTypeFilter, targetTypes);
};

/**
 * Pure predicate: is a specific channel category filter active?
 * Checks if typeFilter includes 'channel' and categoryFilter is exactly [targetCategory].
 */
export const isChannelCategoryActive = (
  typeFilter: readonly ExpandedEntityType[],
  categoryFilter: readonly ('people' | 'groups')[],
  targetCategory: 'people' | 'groups'
): boolean => {
  if (typeFilter.length !== 1 || typeFilter[0] !== 'channel') return false;
  return categoryFilter.length === 1 && categoryFilter[0] === targetCategory;
};

/**
 * Pure predicate: is a specific entity type filter active (exclusive)?
 * Checks if typeFilter is exactly [type].
 */
export const isEntityTypeFilterActive = (
  typeFilter: readonly ExpandedEntityType[],
  type: ExpandedEntityType
): boolean => {
  return typeFilter.length === 1 && typeFilter[0] === type;
};

/**
 * Pure predicate: is a focus filter (signal/noise) active?
 * Signal = Inbox, Noise = Other.
 */
export const isFocusFilterActive = (
  focusFilters: readonly ('signal' | 'noise')[] | undefined,
  target: 'signal' | 'noise'
): boolean => {
  if (!focusFilters || focusFilters.length === 0) return false;
  // Inbox active means signal is in list and noise is not
  // Other active means noise is in list and signal is not
  const hasTarget = focusFilters.includes(target);
  const opposite = target === 'signal' ? 'noise' : 'signal';
  const hasOpposite = focusFilters.includes(opposite);
  return hasTarget && !hasOpposite;
};
