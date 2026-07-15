import {
  EntityPropertiesSection,
  EntityTagsSection,
} from '@app/features/property/side-panel/properties';
import { SidePanel } from '@components/app/side-panel';
import { useBlockId } from '@core/block';
import { useCanEdit } from '@core/signal/permissions';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { Suspense } from 'solid-js';

export function ProjectSidePanelSections() {
  const projectId = useBlockId();
  const canEdit = useCanEdit();
  const projectName = useBlockDocumentName();

  return (
    <>
      <SidePanel.Section id="details" title="Details" defaultOpen order={10}>
        <Suspense fallback={<SidePanel.Loading />}>
          <EntityPropertiesSection
            entityId={projectId}
            entityType="PROJECT"
            canEdit={canEdit()}
            documentName={projectName()}
            includeMetadata
            propertyFilter={(property) => property.isMetadata === true}
            showAddProperty={false}
            showTags={false}
          />
        </Suspense>
      </SidePanel.Section>
      <EntityTagsSection
        entityId={projectId}
        entityType="PROJECT"
        canEdit={canEdit()}
        order={20}
      />
      <SidePanel.Section
        id="properties"
        title="Properties"
        defaultOpen
        order={30}
      >
        <Suspense fallback={<SidePanel.Loading />}>
          <EntityPropertiesSection
            entityId={projectId}
            entityType="PROJECT"
            canEdit={canEdit()}
            documentName={projectName()}
            propertyFilter={(property) => property.isMetadata !== true}
            showTags={false}
          />
        </Suspense>
      </SidePanel.Section>
    </>
  );
}
