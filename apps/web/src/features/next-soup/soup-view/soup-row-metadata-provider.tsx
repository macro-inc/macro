import { EmailLinksProvider } from '@entity/composed/list-entity/email-links-context';
import { TagSetsProvider } from '@property/tags/tag-sets-context';
import { useEmailLinksQuery } from '@queries/email/link';
import type { Link } from '@service-email/generated/schemas';
import type { FlowComponent } from 'solid-js';
import { useSoupView } from './soup-view-context';

/**
 * Owns non-soup queries used to enrich virtualized entity rows and adapts
 * soup-owned metadata into the domain contexts consumed by row components.
 */
export const SoupRowMetadataProvider: FlowComponent = (props) => {
  const { tagFilter } = useSoupView();
  const emailLinksQuery = useEmailLinksQuery();
  const emailLinks = (): Link[] => emailLinksQuery.data?.links ?? [];

  return (
    <EmailLinksProvider links={emailLinks}>
      <TagSetsProvider tagSets={tagFilter.tagSets}>
        {props.children}
      </TagSetsProvider>
    </EmailLinksProvider>
  );
};
