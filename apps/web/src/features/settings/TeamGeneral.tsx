import { toast } from '@core/component/Toast/Toast';
import {
  getLinkShareScope,
  LINK_SHARE_SCOPE_OPTIONS,
  type LinkShareScope,
  NO_LINK_SHARE,
} from '@core/component/TopBar/linkShare';
import { getWebOrigin } from '@core/util/webOrigin';
import CheckIcon from '@phosphor/check.svg';
import CopyIcon from '@phosphor/copy.svg';
import SpinnerIcon from '@phosphor/spinner.svg';
import TrashIcon from '@phosphor/trash.svg';
import XIcon from '@phosphor/x.svg';
import {
  useDeleteTeamMutation,
  usePatchTeamMutation,
} from '@queries/team/teams';
import type { Team as TeamSummary } from '@service-auth/generated/schemas/team';
import { Button, Dialog, Panel, Tabs, Tooltip } from '@ui';
import { createSignal, Show } from 'solid-js';
import {
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from './primitives';
import { teamNameSchema, useTeamViewer } from './Team';
import {
  buildTeamTaskAutolinkTargetUrl,
  getTeamSlugError,
  normalizeTeamSlugInput,
} from './teamSlug';

/** Disabled field shown to non-owners, with a tooltip explaining why it's locked.
 *  The muted look comes from `settings-input`'s `:disabled` styling. */
function ReadOnlyField(props: { value: string; tooltip: string }) {
  return (
    <Tooltip label={props.tooltip} placement="top">
      <input
        type="text"
        value={props.value}
        disabled
        class="settings-input w-56 mobile:w-32"
      />
    </Tooltip>
  );
}

/** The Save / Cancel cluster shown while an inline field has unsaved changes. */
function SaveCancelButtons(props: {
  onSave: () => void;
  onCancel: () => void;
  saveDisabled?: boolean;
  pending?: boolean;
}) {
  return (
    <div class="flex items-center gap-1 shrink-0">
      <Tooltip label="Save">
        <Button
          variant="accent"
          size="icon-sm"
          disabled={props.saveDisabled}
          onClick={props.onSave}
        >
          <Show when={props.pending} fallback={<CheckIcon class="size-4" />}>
            <SpinnerIcon class="size-4 animate-spin" />
          </Show>
        </Button>
      </Tooltip>
      <Tooltip label="Cancel">
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={props.pending}
          onClick={props.onCancel}
        >
          <XIcon class="size-4" />
        </Button>
      </Tooltip>
    </div>
  );
}

/** Team › General: name, slug, link sharing, and deletion. */
export function TeamGeneral(props: { team: TeamSummary }) {
  const { teamQuery, isOwner, isAdminOrOwner } = useTeamViewer(
    () => props.team
  );

  const patchTeamMutation = usePatchTeamMutation();
  const deleteTeamMutation = useDeleteTeamMutation();

  const [showDeleteTeamModal, setShowDeleteTeamModal] = createSignal(false);
  const [deleteConfirmation, setDeleteConfirmation] = createSignal('');
  const [editingTeamName, setEditingTeamName] = createSignal<
    string | undefined
  >(undefined);
  const [editingTeamSlug, setEditingTeamSlug] = createSignal<
    string | undefined
  >(undefined);
  const [teamSlugError, setTeamSlugError] = createSignal<string | undefined>(
    undefined
  );

  const deleteConfirmationPhrase = () => `Delete ${props.team.name}`;
  const canDeleteTeam = () =>
    deleteConfirmation() === deleteConfirmationPhrase();

  const teamNameValue = () => editingTeamName() ?? props.team.name;
  const hasTeamNameChanged = () => {
    const editing = editingTeamName();
    return editing !== undefined && editing.trim() !== props.team.name;
  };

  const teamSlugValue = () => editingTeamSlug() ?? props.team.slug;
  const hasTeamSlugInputChanged = () => {
    const editing = editingTeamSlug();
    return editing !== undefined && editing !== props.team.slug;
  };
  const hasTeamSlugChanged = () => {
    const editing = editingTeamSlug();
    return (
      editing !== undefined &&
      normalizeTeamSlugInput(editing) !== props.team.slug
    );
  };
  const normalizedTeamSlugPreview = () => {
    const editing = editingTeamSlug();
    if (editing === undefined || !hasTeamSlugChanged()) return undefined;
    if (getTeamSlugError(editing)) return undefined;

    const normalized = normalizeTeamSlugInput(editing);
    return normalized === editing ? undefined : normalized;
  };
  const canSaveTeamSlug = () => {
    const editing = editingTeamSlug();
    return (
      editing !== undefined &&
      hasTeamSlugChanged() &&
      !patchTeamMutation.isPending &&
      getTeamSlugError(editing) === undefined
    );
  };

  // The team-wide default link-share scope for newly shared items. NONE
  // (stored as null) means link sharing starts off.
  const defaultLinkShare = () =>
    getLinkShareScope(teamQuery.data?.team.default_link_share);

  const handleChangeDefaultLinkShare = (scope: LinkShareScope) => {
    if (!props.team.id || patchTeamMutation.isPending) return;
    if (scope === defaultLinkShare()) return;
    patchTeamMutation.mutate({
      teamId: props.team.id,
      request: { default_link_share: scope === NO_LINK_SHARE ? null : scope },
    });
  };

  const handleSaveTeamName = () => {
    const newName = editingTeamName()?.trim();
    if (!props.team.id || !newName) return;

    // Validate against the same schema as the create flow (e.g. max length)
    // so rename can't push a name the create path would reject.
    const parsed = teamNameSchema.safeParse(newName);
    if (!parsed.success) return;

    patchTeamMutation.mutate(
      { teamId: props.team.id, request: { name: parsed.data } },
      { onSuccess: () => setEditingTeamName(undefined) }
    );
  };

  const handleCancelTeamNameEdit = () => {
    setEditingTeamName(undefined);
  };

  const validateTeamSlug = (slug: string) => {
    const error = getTeamSlugError(slug);
    setTeamSlugError(error);
    return error === undefined;
  };

  const handleTeamSlugChange = (slug: string) => {
    setEditingTeamSlug(slug);
    validateTeamSlug(slug);
  };

  const handleSaveTeamSlug = () => {
    const editedSlug = editingTeamSlug();
    if (!props.team.id || editedSlug === undefined) return;
    if (!validateTeamSlug(editedSlug) || !hasTeamSlugChanged()) return;

    // Persist the normalized slug so the saved value matches the "Will save as"
    // preview (and the backend's UPPERCASE_UNDERSCORE format).
    patchTeamMutation.mutate(
      {
        teamId: props.team.id,
        request: { slug: normalizeTeamSlugInput(editedSlug) },
      },
      {
        onSuccess: () => {
          setEditingTeamSlug(undefined);
          setTeamSlugError(undefined);
        },
      }
    );
  };

  const handleCancelTeamSlugEdit = () => {
    setEditingTeamSlug(undefined);
    setTeamSlugError(undefined);
  };

  const handleCopyGithubAutolinkUrl = async () => {
    const targetUrl = buildTeamTaskAutolinkTargetUrl(
      props.team.slug,
      getWebOrigin()
    );
    try {
      await navigator.clipboard.writeText(targetUrl);
      toast.success('GitHub autolink URL copied');
    } catch (error) {
      console.error('Failed to copy GitHub autolink URL', error);
      toast.failure('Failed to copy GitHub autolink URL');
    }
  };

  const handleDeleteTeam = () => {
    if (!props.team.id) return;

    deleteTeamMutation.mutate(
      { teamId: props.team.id },
      {
        onSuccess: () => {
          setDeleteConfirmation('');
          setShowDeleteTeamModal(false);
        },
      }
    );
  };

  const handleDeleteTeamModalClose = (open: boolean) => {
    if (!open) {
      setDeleteConfirmation('');
      setShowDeleteTeamModal(false);
    }
  };

  return (
    <>
      <SettingsPage
        title="Team"
        actions={
          <Show when={isOwner()}>
            <Button
              variant="danger"
              size="sm"
              onClick={() => setShowDeleteTeamModal(true)}
            >
              <TrashIcon class="size-4" />
              Delete Team
            </Button>
          </Show>
        }
      >
        <SettingsSection title="General">
          <SettingsCard>
            <SettingsRow
              label="Name"
              description="What your team is called — shown in invitations and billing."
              hideDescriptionOnMobile
            >
              <Show
                when={isOwner()}
                fallback={
                  <ReadOnlyField
                    value={props.team.name}
                    tooltip="Only the team owner can change the team name."
                  />
                }
              >
                <div class="flex items-center gap-2">
                  <input
                    type="text"
                    value={teamNameValue()}
                    onInput={(e) => setEditingTeamName(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        if (hasTeamNameChanged() && editingTeamName()?.trim()) {
                          handleSaveTeamName();
                        }
                      } else if (e.key === 'Escape') {
                        handleCancelTeamNameEdit();
                        e.currentTarget.blur();
                      }
                    }}
                    placeholder="Enter team name"
                    class="settings-input w-56 mobile:w-32"
                  />
                  <Show when={hasTeamNameChanged()}>
                    <SaveCancelButtons
                      onSave={handleSaveTeamName}
                      onCancel={handleCancelTeamNameEdit}
                      saveDisabled={
                        patchTeamMutation.isPending ||
                        !editingTeamName()?.trim()
                      }
                      pending={patchTeamMutation.isPending}
                    />
                  </Show>
                </div>
              </Show>
            </SettingsRow>

            <SettingsRow
              label="Slug"
              description="Short code in task references like ENG-42 (GitHub, branch names)."
              hideDescriptionOnMobile
            >
              <Show
                when={isOwner()}
                fallback={
                  <ReadOnlyField
                    value={props.team.slug}
                    tooltip="Only the team owner can change the team slug."
                  />
                }
              >
                <div class="flex items-center gap-2">
                  <div class="flex flex-col items-end gap-1 min-w-0">
                    <input
                      type="text"
                      value={teamSlugValue()}
                      onInput={(e) =>
                        handleTeamSlugChange(e.currentTarget.value)
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          if (canSaveTeamSlug()) handleSaveTeamSlug();
                        } else if (e.key === 'Escape') {
                          handleCancelTeamSlugEdit();
                          e.currentTarget.blur();
                        }
                      }}
                      placeholder="Enter team slug"
                      class="settings-input w-56 mobile:w-32"
                      aria-invalid={!!teamSlugError()}
                    />
                    <Show when={teamSlugError()}>
                      <p class="text-xs text-failure-ink text-right">
                        {teamSlugError()}
                      </p>
                    </Show>
                    <Show when={normalizedTeamSlugPreview()}>
                      <p class="text-xs text-ink-muted text-right">
                        Will save as {normalizedTeamSlugPreview()}
                      </p>
                    </Show>
                  </div>
                  <Show when={hasTeamSlugInputChanged()}>
                    <SaveCancelButtons
                      onSave={handleSaveTeamSlug}
                      onCancel={handleCancelTeamSlugEdit}
                      saveDisabled={!canSaveTeamSlug()}
                      pending={patchTeamMutation.isPending}
                    />
                  </Show>
                </div>
              </Show>
            </SettingsRow>

            <SettingsRow
              label="GitHub autolink"
              description={
                <>
                  Use <code>{props.team.slug}-</code> as the reference prefix in
                  GitHub, then paste this target URL.
                </>
              }
              hideDescriptionOnMobile
            >
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyGithubAutolinkUrl}
              >
                <CopyIcon class="size-4" />
                Copy target URL
              </Button>
            </SettingsRow>

            <Show when={isAdminOrOwner()}>
              <SettingsRow
                label="Default link sharing"
                description="The link-sharing scope newly shared items start with. None means link sharing starts off."
                hideDescriptionOnMobile
              >
                <Tabs
                  touch="segmented"
                  aria-label="Default link sharing scope"
                  size="sm"
                  value={defaultLinkShare()}
                  options={LINK_SHARE_SCOPE_OPTIONS.map((option) => ({
                    ...option,
                    disabled:
                      patchTeamMutation.isPending || teamQuery.isLoading,
                  }))}
                  onChange={handleChangeDefaultLinkShare}
                />
              </SettingsRow>
            </Show>
          </SettingsCard>
        </SettingsSection>
      </SettingsPage>

      <Dialog
        open={showDeleteTeamModal()}
        onOpenChange={handleDeleteTeamModalClose}
      >
        <Panel depth={2} class="max-h-[75vh] text-ink rounded-xl">
          <Panel.Header class="px-2 gap-1">
            <Dialog.CloseButton as={Button} variant="ghost" size="icon-sm">
              <XIcon />
            </Dialog.CloseButton>
            <Dialog.Title as="span" class="text-sm font-medium p-0 m-0">
              Delete Team
            </Dialog.Title>
          </Panel.Header>
          <Panel.Body class="p-3 flex flex-col gap-3">
            <p>
              Are you sure you want to delete{' '}
              <span class="font-medium">{props.team.name}</span>? This action
              cannot be undone and all team members will lose access.
            </p>
            <p class="text-sm text-ink-muted">
              Type{' '}
              <span class="font-medium text-ink">
                {deleteConfirmationPhrase()}
              </span>{' '}
              to confirm.
            </p>
            <input
              type="text"
              value={deleteConfirmation()}
              onInput={(e) => setDeleteConfirmation(e.currentTarget.value)}
              placeholder={deleteConfirmationPhrase()}
              class="settings-input w-full"
            />
            <div class="flex justify-end gap-1 pt-2">
              <Button
                variant="ghost"
                disabled={deleteTeamMutation.isPending}
                onClick={() => handleDeleteTeamModalClose(false)}
              >
                Cancel
              </Button>
              <Button
                variant="strong"
                disabled={!canDeleteTeam() || deleteTeamMutation.isPending}
                onClick={handleDeleteTeam}
              >
                <Show
                  when={deleteTeamMutation.isPending}
                  fallback="Delete Team"
                >
                  <SpinnerIcon class="size-4 animate-spin" />
                </Show>
              </Button>
            </div>
          </Panel.Body>
        </Panel>
      </Dialog>
    </>
  );
}
