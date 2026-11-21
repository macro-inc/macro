import { InlineTitleEditor } from '@core/component/InlineTitleEditor';
import { fireAndForget } from '@core/util/fireAndForget';
import { buildStartDateDefaultProperty } from '@entity/extractors-property';
import { PropertyValuePill } from '@property/component/PropertyValuePill';
import { startDueEditorFor } from '@property/editors/popover/start-due-editor-for';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import type { Property } from '@property/types';
import { isDateProperty } from '@property/utils';
import { formatStartDue, startDueOf } from '@property/utils/start-due';
import { Key } from '@solid-primitives/keyed';
import { createSignal, type ParentProps, Show } from 'solid-js';
import type { ProjectWorkspaceProps } from '../../context/project-workspace';
import { useProjectsContext } from '../../context/projects-context';
import { canEditProject } from '../../core/project';

export function ProjectSummary(props: ParentProps<ProjectWorkspaceProps>) {
  const [error, setError] = createSignal<string>();
  // The due date pill reads as the range and sets the start too; the start
  // has no pill of its own.
  const projects = useProjectsContext();
  const startDateEnabled = () => projects.startDatesEnabled?.() ?? false;
  const pills = () =>
    props.source
      .properties()
      .filter(
        (property) =>
          property.propertyDefinitionId !== SYSTEM_PROPERTY_IDS.START_DATE
      );
  const startDate = () => {
    const property =
      props.source
        .properties()
        .find(
          (candidate) =>
            candidate.propertyDefinitionId === SYSTEM_PROPERTY_IDS.START_DATE
        ) ?? buildStartDateDefaultProperty();
    return isDateProperty(property) ? property : undefined;
  };
  const dueDatesText = (property: Property) => {
    if (
      !startDateEnabled() ||
      property.propertyDefinitionId !== SYSTEM_PROPERTY_IDS.DUE_DATE
    ) {
      return undefined;
    }
    return formatStartDue(startDueOf(startDate(), property));
  };
  const dueDatesEditor = startDueEditorFor({
    field: 'due',
    enabled: startDateEnabled,
    other: startDate,
    saveOther: (property, value) =>
      props.commands.saveProperty(props.project.id, property, {
        valueType: 'DATE',
        value,
      }),
  });
  const rename = async (name: string) => {
    setError(undefined);
    try {
      await props.commands.rename(props.project.id, name);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Could not save project.'
      );
    }
  };
  return (
    <>
      <Show when={error()}>
        {(message) => (
          <p role="alert" class="text-sm text-failure">
            {message()}
          </p>
        )}
      </Show>
      <Show
        when={canEditProject(props.project)}
        fallback={<h1 class="text-2xl font-semibold">{props.project.name}</h1>}
      >
        <InlineTitleEditor
          value={props.project.name}
          placeholder="Project name"
          ariaLabel="Project name"
          class="w-full text-2xl"
          onRename={(name) => fireAndForget(rename(name), 'projects')}
        />
      </Show>
      <div
        class="mb-6 mt-3 flex flex-row flex-wrap items-center gap-2 text-sm empty:hidden"
        aria-label="Project properties"
      >
        <Key each={pills()} by="propertyDefinitionId">
          {(property) => (
            <PropertyValuePill
              variant="secondary"
              size="xs"
              property={property()}
              valueText={dueDatesText(property())}
              editor={
                property().propertyDefinitionId === SYSTEM_PROPERTY_IDS.DUE_DATE
                  ? dueDatesEditor
                  : undefined
              }
              canEdit={canEditProject(props.project)}
              onSave={(property, value) =>
                props.commands.saveProperty(props.project.id, property, value)
              }
              entitySelfFilter={{
                blockId: props.project.id,
                entityType: 'INITIATIVE',
              }}
            />
          )}
        </Key>
      </div>
      {props.children}
    </>
  );
}
