import { SidePanel } from '@app/component/side-panel';
import { EntityPropertiesSection } from '@app/features/property/side-panel/properties';
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
      <SidePanel.Section
        id="properties"
        title="Properties"
        defaultOpen
        order={20}
      >
        <Suspense fallback={<SidePanel.Loading />}>
          <EntityPropertiesSection
            entityId={projectId}
            entityType="PROJECT"
            canEdit={canEdit()}
            documentName={projectName()}
            propertyFilter={(property) => property.isMetadata !== true}
          />
        </Suspense>
      </SidePanel.Section>
    </>
  );
}
