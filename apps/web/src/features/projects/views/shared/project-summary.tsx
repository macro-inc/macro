import { InlineTitleEditor } from '@core/component/InlineTitleEditor';
import { fireAndForget } from '@core/util/fireAndForget';
import { PropertyValuePill } from '@property/component/PropertyValuePill';
import { Key } from '@solid-primitives/keyed';
import { createSignal, type ParentProps, Show } from 'solid-js';
import type { ProjectWorkspaceProps } from '../../context/project-workspace';
import { canEditProject } from '../../core/project';

export function ProjectSummary(props: ParentProps<ProjectWorkspaceProps>) {
  const [error, setError] = createSignal<string>();
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
        <Key each={props.source.properties()} by="propertyDefinitionId">
          {(property) => (
            <PropertyValuePill
              variant="secondary"
              size="xs"
              property={property()}
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
