import { SidePanel } from '@components/app/side-panel';
import { EntityMetadata } from '@components/app/side-panel/EntityMetadata';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import { EntityPropertiesSection } from '@property/side-panel/properties/EntityPropertiesSection';
import { type ParentProps, Show } from 'solid-js';
import type { ProjectWorkspaceProps } from '../../context/project-workspace';
import { useProjectsContext } from '../../context/projects-context';
import { canEditProject } from '../../core/project';

const PROJECT_PROPERTY_ORDER = [
  SYSTEM_PROPERTY_IDS.STATUS,
  SYSTEM_PROPERTY_IDS.PRIORITY,
  SYSTEM_PROPERTY_IDS.ASSIGNEES,
  SYSTEM_PROPERTY_IDS.DUE_DATE,
];

/** Details remain available from both platform headers and the summary. */
export function ProjectWorkspaceLayout(
  props: ParentProps<ProjectWorkspaceProps>
) {
  const definitions = useProjectsContext().createPropertyDefinitionsSource();
  return (
    <SidePanel.Layout headerToggle={false} floating defaultOpen={false}>
      <SidePanel.Footer>
        <EntityMetadata
          ownerId={props.project.ownerId}
          createdAt={props.project.createdAt}
          updatedAt={props.project.updatedAt}
        />
      </SidePanel.Footer>
      <SidePanel.Section
        id="properties"
        title="Properties"
        defaultOpen
        order={1}
        render={(renderSection) => (
          <Show when={props.project.id} keyed>
            {(projectId) => (
              <EntityPropertiesSection
                entityId={projectId}
                entityType="INITIATIVE"
                canEdit={canEditProject(props.project)}
                documentName={props.project.name}
                showTags={false}
                defaultProperties={() => [...definitions.properties()]}
                requiredPropertyDefinitionIds={PROJECT_PROPERTY_ORDER}
                pinnedPropertyDefinitionOrder={PROJECT_PROPERTY_ORDER}
                onPropertiesChanged={props.source.refresh}
                renderSection={renderSection}
              />
            )}
          </Show>
        )}
      />
      {props.children}
    </SidePanel.Layout>
  );
}
