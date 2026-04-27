import { Show } from 'solid-js';
import type { EntityData } from '../types/entity';
import type { ContentHitData, SearchLocation } from '../types/search';
import { isSearchEntity } from '../types/search';
import { CollapsibleList } from '../components/CollapsibleList';
import { SearchContentHitRow } from './search-content-hit-row';
import { dedupeContentHits } from './dedupe-content-hits';

interface ExtractorContentHitsProps {
  entity: EntityData;
  onClick?: (e: PointerEvent | MouseEvent, location?: SearchLocation) => void;
  visibleCount?: number;
}

/**
 * Renders collapsible list of content hit rows
 */
export function ContentHits(props: ExtractorContentHitsProps) {
  const contentHits = (): ContentHitData[] => {
    if (!isSearchEntity(props.entity)) return [];
    // channel_message entities render their content inline in the row,
    // so skip the expandable content hits section to avoid duplication
    if (props.entity.type === 'channel_message') return [];
    return props.entity.search.contentHitData ?? [];
  };

  const visibleCount = () => props.visibleCount ?? 1;

  const dedupedHits = () => dedupeContentHits(contentHits());

  // When visibleCount=0, the parent component renders the longest hit's
  // content as the visible snippet. If only one unique-content hit remains
  // after dedup, expanding "show more" reveals nothing new — hide entirely.
  const shouldRender = () => {
    const hits = dedupedHits();
    if (hits.length === 0) return false;
    if (visibleCount() === 0 && hits.length === 1) return false;
    return true;
  };

  return (
    <Show when={shouldRender()}>
      <CollapsibleList
        items={dedupedHits()}
        visibleCount={visibleCount()}
        expandText={(count) => `Show more [${count}]`}
      >
        {(hit, index, count) => (
          <SearchContentHitRow
            hit={hit}
            onClick={props.onClick}
            index={index}
            count={count}
          />
        )}
      </CollapsibleList>
    </Show>
  );
}
