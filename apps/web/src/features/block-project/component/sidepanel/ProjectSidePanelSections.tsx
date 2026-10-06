import { EntityActivitySectionConditional } from '@app/features/activity/views/entity-activity-section';
import {
  EntityPropertiesSection,
  EntityTagsSection,
} from '@app/features/property/side-panel/properties';
import { SidePanel } from '@components/app/side-panel';
import { EntityMetadata } from '@components/app/side-panel/EntityMetadata';
import { useBlockId } from '@core/block';
import { useCanEdit } from '@core/signal/permissions';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { useProjectDataQuery } from '@queries/storage/project-data';
import { Suspense } from 'solid-js';

export function ProjectSidePanelSections() {
  const projectId = useBlockId();
  const canEdit = useCanEdit();
  const projectName = useBlockDocumentName();

  return (
    <>
      <SidePanel.Footer>
        <Suspense fallback={<SidePanel.Loading />}>
          <ProjectMetadata projectId={projectId} />
        </Suspense>
      </SidePanel.Footer>
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
      <EntityActivitySectionConditional
        entityId={projectId}
        entityType="PROJECT"
        order={40}
      />
    </>
  );
}

function ProjectMetadata(props: { projectId: string }) {
  const query = useProjectDataQuery(() => props.projectId);
  return (
    <EntityMetadata
      ownerId={query.data?.userId}
      createdAt={query.data?.createdAt}
      updatedAt={query.data?.updatedAt}
    />
  );
}
