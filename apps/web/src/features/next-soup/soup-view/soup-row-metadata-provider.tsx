import { TagSetsProvider } from '@property/tags/tag-sets-context';
import type { FlowComponent } from 'solid-js';
import { useSoupView } from './soup-view-context';

/**
 * Adapts soup-owned metadata into the domain contexts consumed by virtualized
 * row components.
 */
export const SoupRowMetadataProvider: FlowComponent = (props) => {
  const { tagFilter } = useSoupView();

  return (
    <TagSetsProvider tagSets={tagFilter.tagSets}>
      {props.children}
    </TagSetsProvider>
  );
};
