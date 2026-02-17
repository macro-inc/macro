/**
 * Get the label text for the "view all" button.
 * Returns undefined if the bucket cannot be expanded.
 */
export function getViewAllLabel(
  totalCount: number | undefined,
  showingCount: number | undefined,
  hasNextPage?: boolean
): string | undefined {
  if (totalCount && showingCount && totalCount > showingCount) {
    return `View all (${totalCount})`;
  }
  if (hasNextPage) {
    return 'View all';
  }
  return undefined;
}

/**
 * Determine if the "view all" button should be shown.
 */
export function shouldShowViewAllButton(
  totalCount: number | undefined,
  showingCount: number | undefined,
  hasNextPage?: boolean
): boolean {
  return (
    (totalCount !== undefined &&
      showingCount !== undefined &&
      totalCount > showingCount) ||
    hasNextPage === true
  );
}
