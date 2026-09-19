import PencilIcon from '@phosphor/pencil-simple.svg';
import PlusIcon from '@phosphor/plus.svg';
import SpinnerIcon from '@phosphor/spinner.svg';
import TrashIcon from '@phosphor/trash.svg';
import UsersIcon from '@phosphor/users-three.svg';
import XIcon from '@phosphor/x.svg';
import { TagDot } from '@property/tags/TagDot';
import {
  type EditableTag,
  TagEditorDialog,
  type TagEditorDialogMode,
} from '@property/tags/TagEditorDialog';
import { useTagTeamSharingFlag } from '@property/tags/use-tag-team-sharing-flag';
import {
  useDeletePropertyOptionMutation,
  useMergeTagMutation,
  usePromoteTagMutation,
  useTagsQuery,
} from '@queries/properties/tags';
import { useCurrentTeamQuery } from '@queries/team/teams';
import { parseTagNameConflict } from '@service-properties/client';
import type { PropertyOptionResponse } from '@service-properties/generated/schemas/propertyOptionResponse';
import type { TagScope } from '@service-properties/generated/schemas/tagScope';
import type { TagSetResponse } from '@service-properties/generated/schemas/tagSetResponse';
import { Button, Dialog, Panel, Tooltip } from '@ui';
import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';
import { SettingsCard, SettingsPage, SettingsSection } from './primitives';

function optionLabel(option: PropertyOptionResponse | undefined): string {
  return option?.value.type === 'string' ? option.value.value : '';
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

/** A pending share blocked by a same-named team label. */
type ShareConflict = {
  tag: EditableTag;
  conflictingOption: PropertyOptionResponse;
};

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
  /** Omitted when the tag can't be shared (team scope, no team, flag off). */
  onShare?: (tag: EditableTag) => void;
  deleting?: boolean;
  sharingOptionId?: string;
}) {
  const options = createMemo(() => sortedOptions(props.set));
  const editable = () => Boolean(props.set?.definition);

  return (
    <SettingsSection
      title={props.title}
      description={props.description}
      actions={
        <Button
          variant="outline"
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
                        <Show when={props.onShare}>
                          {(onShare) => (
                            <Tooltip label="Share with team">
                              <button
                                type="button"
                                aria-label={`Share ${optionLabel(option)} with team`}
                                class="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-extra-muted outline-none hover:bg-hover hover:text-ink focus-visible:border focus-visible:border-accent disabled:opacity-30"
                                disabled={
                                  props.deleting ||
                                  props.sharingOptionId !== undefined
                                }
                                onClick={() => onShare()(tag())}
                              >
                                <Show
                                  when={props.sharingOptionId === option.id}
                                  fallback={<UsersIcon class="size-4" />}
                                >
                                  <SpinnerIcon class="size-4 animate-spin" />
                                </Show>
                              </button>
                            </Tooltip>
                          )}
                        </Show>
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

/** Panel-shaped confirm dialog, matching the Team tab's action dialogs. */
function ConfirmDialog(props: {
  open: boolean;
  title: string;
  confirmLabel: string;
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children: JSX.Element;
}) {
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => !open && !props.pending && props.onClose()}
    >
      <Panel depth={2} class="max-h-[75vh] rounded-xl text-ink">
        <Panel.Header class="gap-1 px-2">
          <Dialog.CloseButton
            as={Button}
            variant="ghost"
            size="icon-sm"
            disabled={props.pending}
          >
            <XIcon />
          </Dialog.CloseButton>
          <Dialog.Title as="span" class="m-0 p-0 text-sm font-medium">
            {props.title}
          </Dialog.Title>
        </Panel.Header>
        <Panel.Body class="flex flex-col gap-3 p-3">
          <p class="text-sm text-ink-muted">{props.children}</p>
          <div class="flex justify-end gap-1 pt-2">
            <Button
              variant="ghost"
              class="rounded-xs"
              disabled={props.pending}
              onClick={props.onClose}
            >
              Cancel
            </Button>
            <Button
              variant="accent"
              class="rounded-xs"
              disabled={props.pending}
              onClick={props.onConfirm}
            >
              <Show when={props.pending} fallback={props.confirmLabel}>
                <SpinnerIcon class="size-4 animate-spin" />
              </Show>
            </Button>
          </div>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}

export function Tags() {
  const tagsQuery = useTagsQuery();
  const teamQuery = useCurrentTeamQuery();
  const deleteTag = useDeletePropertyOptionMutation();
  const promoteTag = usePromoteTagMutation();
  const mergeTag = useMergeTagMutation();
  const teamSharingEnabled = useTagTeamSharingFlag();
  const [editorMode, setEditorMode] = createSignal<TagEditorDialogMode | null>(
    null
  );
  const [sharingOptionId, setSharingOptionId] = createSignal<string>();
  const [pendingShare, setPendingShare] = createSignal<EditableTag | null>(
    null
  );
  const [conflict, setConflict] = createSignal<ShareConflict | null>(null);

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

  // Promotion is one-way — there is no un-share endpoint — so it is confirmed
  // before anything moves.
  const shareTag = (tag: EditableTag) => setPendingShare(tag);

  const confirmShare = () => {
    const tag = pendingShare();
    if (!tag) return;

    setSharingOptionId(tag.option.id);
    promoteTag.mutate(
      { optionId: tag.option.id },
      {
        onSettled: () => setSharingOptionId(undefined),
        onSuccess: () => setPendingShare(null),
        onError: (error) => {
          // The mutation stays silent on a name collision so it can be turned
          // into a prompt here; every other failure already toasted.
          const detected = parseTagNameConflict(error);
          setPendingShare(null);
          if (detected) {
            setConflict({
              tag,
              conflictingOption: detected.conflicting_option,
            });
          }
        },
      }
    );
  };

  const confirmMerge = () => {
    const pending = conflict();
    if (!pending) return;

    mergeTag.mutate(
      {
        optionId: pending.tag.option.id,
        targetOptionId: pending.conflictingOption.id,
      },
      {
        onSuccess: () => setConflict(null),
      }
    );
  };

  // Sharing needs a team to share into, and only personal labels can move.
  const canShare = () => teamSharingEnabled() && hasTeam();

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
        onShare={canShare() ? shareTag : undefined}
        sharingOptionId={sharingOptionId()}
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

      <ConfirmDialog
        open={pendingShare() !== null}
        title="Share with team"
        confirmLabel="Share"
        pending={promoteTag.isPending}
        onConfirm={confirmShare}
        onClose={() => setPendingShare(null)}
      >
        <span class="font-medium text-ink">
          {optionLabel(pendingShare()?.option)}
        </span>{' '}
        moves into the {teamName()} team tag set. This action cannot be
        reversed.
      </ConfirmDialog>

      <ConfirmDialog
        open={conflict() !== null}
        title="Team label already exists"
        confirmLabel="Use team label"
        pending={mergeTag.isPending}
        onConfirm={confirmMerge}
        onClose={() => setConflict(null)}
      >
        Your team already has a label named{' '}
        <span class="font-medium text-ink">
          {optionLabel(conflict()?.conflictingOption)}
        </span>
        . Everything tagged with your personal label will be retagged with the
        team's, and your personal label will be removed. This action cannot be
        reversed.
      </ConfirmDialog>
    </SettingsPage>
  );
}
