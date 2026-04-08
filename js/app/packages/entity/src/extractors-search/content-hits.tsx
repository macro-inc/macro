import { Show } from 'solid-js';
import type { EntityData } from '../types/entity';
import type { SearchLocation } from '../types/search';
import { isSearchEntity } from '../types/search';
import { CollapsibleList } from '../components/CollapsibleList';
import { SearchContentHitRow } from './search-content-hit-row';

interface ExtractorContentHitsProps {
  entity: EntityData;
  onClick?: (e: PointerEvent | MouseEvent, location?: SearchLocation) => void;
  visibleCount?: number;
}

/**
 * Renders collapsible list of content hit rows
 */
export function ContentHits(props: ExtractorContentHitsProps) {
  const contentHits = () => {
    if (!isSearchEntity(props.entity)) return [];
    // channel_message entities render their content inline in the row,
    // so skip the expandable content hits section to avoid duplication
    if (props.entity.type === 'channel_message') return [];
    return props.entity.search.contentHitData ?? [];
  };

  return (
    <Show when={contentHits().length > 0}>
      <CollapsibleList
        items={contentHits()}
        visibleCount={props.visibleCount ?? 1}
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
