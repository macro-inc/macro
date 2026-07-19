import { EmailLinksQueryProvider } from '@entity/composed/list-entity/email-links-context';
import { TagSetsProvider } from '@property/tags/tag-sets-context';
import type { FlowComponent } from 'solid-js';
import { useSoupView } from './soup-view-context';

/**
 * Owns non-soup queries used to enrich virtualized entity rows and adapts
 * soup-owned metadata into the domain contexts consumed by row components.
 */
export const SoupRowMetadataProvider: FlowComponent = (props) => {
  const { tagFilter } = useSoupView();

  return (
    <EmailLinksQueryProvider>
      <TagSetsProvider tagSets={tagFilter.tagSets}>
        {props.children}
      </TagSetsProvider>
    </EmailLinksQueryProvider>
  );
};
