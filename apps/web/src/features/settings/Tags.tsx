import PencilIcon from '@phosphor/pencil-simple.svg';
import PlusIcon from '@phosphor/plus.svg';
import TrashIcon from '@phosphor/trash.svg';
import { TagDot } from '@property/tags/TagDot';
import {
  type EditableTag,
  TagEditorDialog,
  type TagEditorDialogMode,
} from '@property/tags/TagEditorDialog';
import {
  useDeletePropertyOptionMutation,
  useTagsQuery,
} from '@queries/properties/tags';
import { useCurrentTeamQuery } from '@queries/team/teams';
import type { PropertyOptionResponse } from '@service-properties/generated/schemas/propertyOptionResponse';
import type { TagScope } from '@service-properties/generated/schemas/tagScope';
import type { TagSetResponse } from '@service-properties/generated/schemas/tagSetResponse';
import { Button, Tooltip } from '@ui';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { SettingsCard, SettingsPage, SettingsSection } from './primitives';

function optionLabel(option: PropertyOptionResponse): string {
  return option.value.type === 'string' ? option.value.value : '';
}

function sortedOptions(set: TagSetResponse | undefined) {
  return [...(set?.options ?? [])].sort(
    (a, b) => a.displayOrder - b.displayOrder
  );
}

function tagForOption(
  scope: TagScope,
  set: TagSetResponse,
  option: PropertyOptionResponse
): EditableTag {
  return {
    scope,
    propertyDefinitionId: set.definition?.id ?? option.propertyDefinitionId,
    option,
  };
}

function EmptyTagRows(props: { scope: TagScope }) {
  return (
    <div class="px-6 py-8 text-center text-sm text-ink-extra-muted">
      No {props.scope === 'team' ? 'team' : 'personal'} tags
    </div>
  );
}

function TagListSection(props: {
  title: string;
  description?: string;
  scope: TagScope;
  set: TagSetResponse | undefined;
  onCreate: (scope: TagScope) => void;
  onEdit: (tag: EditableTag) => void;
  onDelete: (tag: EditableTag) => void;
  deleting?: boolean;
}) {
  const options = createMemo(() => sortedOptions(props.set));
  const editable = () => Boolean(props.set?.definition);

  return (
    <SettingsSection
      title={props.title}
      description={props.description}
      actions={
        <Button
          variant="base"
          size="sm"
          class="rounded-xs"
          onClick={() => props.onCreate(props.scope)}
        >
          <PlusIcon class="size-4" />
          New tag
        </Button>
      }
    >
      <SettingsCard>
        <Show
          when={options().length > 0}
          fallback={<EmptyTagRows scope={props.scope} />}
        >
          <For each={options()}>
            {(option) => (
              <div class="flex min-h-14 items-center gap-3 px-6 py-3">
                <TagDot color={option.color ?? undefined} class="size-3" />
                <div class="min-w-0 flex-1">
                  <div class="truncate text-sm font-medium text-ink">
                    {optionLabel(option)}
                  </div>
                </div>
                <Show when={editable() && props.set}>
                  {(set) => {
                    const tag = () => tagForOption(props.scope, set(), option);
                    return (
                      <div class="flex shrink-0 items-center gap-1">
                        <Tooltip label="Edit tag">
                          <button
                            type="button"
                            aria-label={`Edit ${optionLabel(option)}`}
                            class="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-extra-muted outline-none hover:bg-hover hover:text-ink focus-visible:border focus-visible:border-accent"
                            disabled={props.deleting}
                            onClick={() => props.onEdit(tag())}
                          >
                            <PencilIcon class="size-4" />
                          </button>
                        </Tooltip>
                        <Tooltip label="Delete tag">
                          <button
                            type="button"
                            aria-label={`Delete ${optionLabel(option)}`}
                            class="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-extra-muted outline-none hover:bg-failure/10 hover:text-failure focus-visible:border focus-visible:border-failure disabled:opacity-30"
                            disabled={props.deleting}
                            onClick={() => props.onDelete(tag())}
                          >
                            <TrashIcon class="size-4" />
                          </button>
                        </Tooltip>
                      </div>
                    );
                  }}
                </Show>
              </div>
            )}
          </For>
        </Show>
      </SettingsCard>
    </SettingsSection>
  );
}

export function Tags() {
  const tagsQuery = useTagsQuery();
  const teamQuery = useCurrentTeamQuery();
  const deleteTag = useDeletePropertyOptionMutation();
  const [editorMode, setEditorMode] = createSignal<TagEditorDialogMode | null>(
    null
  );

  const tagSet = (scope: TagScope) =>
    tagsQuery.data?.find((set) => set.scope === scope);
  const teamName = () => teamQuery.data?.team.name?.trim() || 'Team';
  const hasTeam = () =>
    tagsQuery.data?.some((set) => set.scope === 'team') ||
    Boolean(teamQuery.data?.team);

  const openCreate = (scope: TagScope) => {
    setEditorMode({ type: 'create', initialScope: scope });
  };

  const openEdit = (tag: EditableTag) => {
    setEditorMode({ type: 'edit', tag });
  };

  const removeTag = (tag: EditableTag) => {
    deleteTag.mutate({
      propertyDefinitionId: tag.propertyDefinitionId,
      optionId: tag.option.id,
    });
  };

  return (
    <SettingsPage
      title="Tags"
      description="Manage personal labels and shared team labels."
      actions={
        <Button
          variant="cta"
          size="sm"
          depth={3}
          onClick={() => openCreate('user')}
        >
          <PlusIcon class="size-4" />
          New tag
        </Button>
      }
    >
      <TagListSection
        title="Personal"
        scope="user"
        set={tagSet('user')}
        onCreate={openCreate}
        onEdit={openEdit}
        onDelete={removeTag}
        deleting={deleteTag.isPending}
      />
      <Show when={hasTeam()}>
        <TagListSection
          title="Team"
          description={teamName()}
          scope="team"
          set={tagSet('team')}
          onCreate={openCreate}
          onEdit={openEdit}
          onDelete={removeTag}
          deleting={deleteTag.isPending}
        />
      </Show>

      <TagEditorDialog
        open={editorMode() !== null}
        mode={editorMode()}
        teamAvailable={hasTeam()}
        onClose={() => setEditorMode(null)}
      />
    </SettingsPage>
  );
}
