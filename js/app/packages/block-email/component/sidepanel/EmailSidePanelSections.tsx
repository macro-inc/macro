import { SidePanel } from '@app/component/side-panel';
import { EntityPropertiesSection } from '@app/component/side-panel/properties';
import type { Property } from '@property/types';
import { Suspense } from 'solid-js';
import { useEmailContext } from '../EmailContext';

interface EmailSidePanelSectionsProps {
  threadId: string;
  title: string;
}

export function EmailSidePanelSections(props: EmailSidePanelSectionsProps) {
  const emailCtx = useEmailContext();
  const canEdit = () => emailCtx.permissions().isOwner;

  return (
    <>
      <SidePanel.Section id="details" title="Details" defaultOpen order={10}>
        <Suspense fallback={<SidePanel.Loading />}>
          <EntityPropertiesSection
            entityId={props.threadId}
            entityType="THREAD"
            canEdit={canEdit()}
            documentName={props.title}
            includeMetadata
            propertyFilter={(property) => property.isMetadata === true}
            getEmptyLabel={getEmailMetadataEmptyLabel}
            showAddProperty={false}
          />
        </Suspense>
      </SidePanel.Section>
      <SidePanel.Section
        id="properties"
        title="Properties"
        defaultOpen
        order={20}
      >
        <Suspense fallback={<SidePanel.Loading />}>
          <EntityPropertiesSection
            entityId={props.threadId}
            entityType="THREAD"
            canEdit={canEdit()}
            documentName={props.title}
            propertyFilter={(property) => property.isMetadata !== true}
          />
        </Suspense>
      </SidePanel.Section>
    </>
  );
}

function getEmailMetadataEmptyLabel(property: Property) {
  if (!property.isMetadata) return undefined;

  switch (property.displayName) {
    case 'Last Sent':
      return 'No sent messages';
    case 'Last Received':
      return 'No received messages';
    case 'Thread Started':
      return 'No messages';
    case 'Subject':
      return 'No subject';
    default:
      return undefined;
  }
}
