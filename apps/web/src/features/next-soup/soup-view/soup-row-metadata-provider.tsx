import { useEmailLinksContext } from '@core/context/emailLinks';
import { EmailLinksProvider } from '@entity/composed/list-entity/email-links-context';
import { TagSetsProvider } from '@property/tags/tag-sets-context';
import type { FlowComponent } from 'solid-js';
import { useSoupView } from './soup-view-context';

/**
 * Adapts app- and soup-owned metadata into the domain contexts consumed by
 * virtualized row components.
 */
export const SoupRowMetadataProvider: FlowComponent = (props) => {
  const { links } = useEmailLinksContext();
  const { tagFilter } = useSoupView();

  return (
    <EmailLinksProvider links={links}>
      <TagSetsProvider tagSets={tagFilter.tagSets}>
        {props.children}
      </TagSetsProvider>
    </EmailLinksProvider>
  );
};
