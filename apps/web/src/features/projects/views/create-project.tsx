import ArrowsOutIcon from '@phosphor/arrows-out.svg';
import XIcon from '@phosphor/x.svg';
import { PropertyValuePill } from '@property/component/PropertyValuePill';
import { Button, Checkbox, EntityComposer } from '@ui';
import { For, onMount, Show } from 'solid-js';
import { useProjectsContext } from '../context/projects-context';
import {
  createProjectComposer,
  type ProjectComposerDraft,
} from '../primitives/create-project';
import { withProjectPropertyValue } from '../primitives/property-draft';

export function CreateProject(props: {
  initialDraft?: ProjectComposerDraft;
  onClose(): void;
  onCreated(id: string): void;
  onContinueInSplit?(draft: ProjectComposerDraft): void;
  onFailure?(draft: ProjectComposerDraft): void;
}) {
  const context = useProjectsContext();
  const definitions = context.createPropertyDefinitionsSource();
  const composer = createProjectComposer(
    context.createCommands(),
    props.onCreated,
    props.initialDraft
  );
  let titleInput: HTMLInputElement | undefined;
  onMount(() => titleInput?.focus());
  const submit = async () => {
    if ((await composer.submit()) === 'failed') {
      props.onFailure?.(composer.snapshot());
    }
  };

  return (
    <form
      class="h-full min-h-0"
      aria-label="New project"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      onKeyDown={(event) => {
        if (
          event.key === 'Enter' &&
          (event.metaKey || event.ctrlKey) &&
          !event.isComposing
        ) {
          event.preventDefault();
          event.stopPropagation();
          void submit();
        }
      }}
    >
      <EntityComposer.Root>
        <EntityComposer.Header>
          <div class="flex-1 flex items-center">
            <Show when={props.onContinueInSplit}>
              <Button
                tabIndex={-1}
                aria-label="Continue editing in split"
                tooltip="Continue editing in split"
                size="icon-composer"
                disabled={composer.pending()}
                onClick={() => props.onContinueInSplit?.(composer.snapshot())}
              >
                <ArrowsOutIcon />
              </Button>
            </Show>
          </div>
          <Show
            when={
              !composer.createdId() &&
              (composer.name() || composer.drafts().size > 0)
            }
          >
            <Button
              tabIndex={-1}
              size="sm"
              variant="outline"
              depth={3}
              class="bg-surface px-3"
              disabled={composer.pending()}
              onClick={() => {
                composer.clear();
                titleInput?.focus();
              }}
            >
              Clear Draft
            </Button>
          </Show>
          <Button
            tabIndex={-1}
            aria-label="Close"
            tooltip="Close"
            size="icon-composer"
            disabled={composer.pending()}
            onClick={props.onClose}
          >
            <XIcon />
          </Button>
        </EntityComposer.Header>
        <EntityComposer.Main class="min-h-28 justify-between">
          <EntityComposer.Title>
            <input
              ref={titleInput}
              autofocus
              aria-label="Project name"
              placeholder="Project name"
              class="ph-no-capture w-full min-w-0 text-xl/7 font-medium outline-none bg-transparent placeholder:text-ink-placeholder"
              value={composer.name()}
              required
              disabled={composer.pending() || Boolean(composer.createdId())}
              onInput={(event) => composer.setName(event.currentTarget.value)}
            />
          </EntityComposer.Title>
          <div>
            <EntityComposer.Properties>
              <For each={definitions.properties()}>
                {(property) => (
                  <PropertyValuePill
                    property={withProjectPropertyValue(
                      property,
                      composer.drafts().get(property.propertyDefinitionId)
                        ?.value
                    )}
                    canEdit={!composer.pending()}
                    entitySelfFilter={{
                      entityType: 'INITIATIVE',
                      blockId: composer.createdId(),
                    }}
                    onSave={async (_, value) => {
                      composer.saveDraft(property, value);
                    }}
                  />
                )}
              </For>
            </EntityComposer.Properties>
            <Show when={definitions.loading()}>
              <p role="status" class="text-xs text-ink-muted">
                Loading properties…
              </p>
            </Show>
            <Show when={definitions.error()}>
              <p role="status" class="text-xs text-ink-muted">
                Properties are unavailable. You can set them after creating the
                project.
              </p>
            </Show>
          </div>
        </EntityComposer.Main>
        <Show when={composer.error()}>
          {(error) => (
            <p
              role="alert"
              class="border-t border-edge-muted px-2 pt-3 text-sm text-failure"
            >
              {error()}
            </p>
          )}
        </Show>
        <EntityComposer.Footer class="items-center flex-wrap">
          <Checkbox
            checked={composer.shareWithTeam()}
            disabled={composer.pending() || Boolean(composer.createdId())}
            onChange={composer.setShareWithTeam}
          >
            <Checkbox.Control />
            <Checkbox.Label class="text-xs text-ink-muted font-normal whitespace-nowrap">
              Share with my team
            </Checkbox.Label>
          </Checkbox>
          <EntityComposer.Submit
            type="submit"
            class="ml-auto"
            hasContent={Boolean(composer.name().trim())}
            disabled={composer.pending() || !composer.name().trim()}
          >
            {composer.pending()
              ? 'Saving…'
              : composer.createdId()
                ? 'Retry saving properties'
                : 'Create Project'}
          </EntityComposer.Submit>
        </EntityComposer.Footer>
      </EntityComposer.Root>
    </form>
  );
}
