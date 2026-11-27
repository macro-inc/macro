import { SidePanel } from '@components/app/side-panel';
import { EntityMetadata } from '@components/app/side-panel/EntityMetadata';
import { buildStartDateDefaultProperty } from '@entity/extractors-property';
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
// With start dates, Start Date sits right above the Due Date it begins.
const PROJECT_PROPERTY_ORDER_WITH_DATES = [
  SYSTEM_PROPERTY_IDS.STATUS,
  SYSTEM_PROPERTY_IDS.PRIORITY,
  SYSTEM_PROPERTY_IDS.ASSIGNEES,
  SYSTEM_PROPERTY_IDS.START_DATE,
  SYSTEM_PROPERTY_IDS.DUE_DATE,
];

export function ProjectWorkspaceLayout(
  props: ParentProps<ProjectWorkspaceProps>
) {
  const projects = useProjectsContext();
  const definitions = projects.createPropertyDefinitionsSource();
  const startDateEnabled = () => projects.startDatesEnabled?.() ?? false;
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
                defaultProperties={() =>
                  startDateEnabled()
                    ? [
                        ...definitions.properties(),
                        buildStartDateDefaultProperty(),
                      ]
                    : [...definitions.properties()]
                }
                requiredPropertyDefinitionIds={PROJECT_PROPERTY_ORDER}
                pinnedPropertyDefinitionOrder={
                  startDateEnabled()
                    ? PROJECT_PROPERTY_ORDER_WITH_DATES
                    : PROJECT_PROPERTY_ORDER
                }
                pairStartAndDue={startDateEnabled}
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
