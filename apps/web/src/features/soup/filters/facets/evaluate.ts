import { resolveFacetMode, resolveFacetOption } from './compile';
import type { Facet, FacetOption, FacetSelection } from './types';

/**
 * Tests one item against active facets.
 *
 * Unresolved options and options without a client predicate remain included;
 * the server may already have validated them. Facets combine with AND while
 * each facet combines its selected options according to its mode.
 */
export function testFacets<
  TItem,
  TContext,
  TOption extends FacetOption<TItem, TContext>,
>(
  selection: FacetSelection,
  facets: Facet<TItem, TContext, TOption>[],
  item: TItem,
  context: TContext
): boolean {
  return facets.every((facet) => {
    const active = selection[facet.id] ?? [];
    if (active.length === 0) return true;

    const results = active.map((optionId) =>
      resolveFacetOption(facet, optionId, context)?.predicate?.(item, context)
    );
    const testable = results.filter(
      (result): result is boolean => result !== undefined
    );
    if (testable.length === 0) return true;

    if (resolveFacetMode(facet, context) === 'and') {
      return testable.every(Boolean);
    }
    return testable.some(Boolean) || results.includes(undefined);
  });
}
