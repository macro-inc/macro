import { toast } from '@core/component/Toast/Toast';
import {
  getLinkShareScope,
  LINK_SHARE_SCOPE_OPTIONS,
  type LinkShareScope,
  NO_LINK_SHARE,
} from '@core/component/TopBar/linkShare';
import { UserIcon } from '@core/component/UserIcon';
import { SERVER_HOSTS } from '@core/constant/servers';
import { useUserId } from '@core/context/user';
import { getDisplayName, macroIdToEmail, tryMacroId } from '@core/user';
import { debouncedDependent } from '@core/util/debounce';
import { fuzzyFilter } from '@core/util/fuzzy';
import { getWebOrigin } from '@core/util/webOrigin';
import { formatRelativeTimestamp } from '@entity';
import GithubIcon from '@icon/mcp-github.svg';
import type { CollectionNode } from '@kobalte/core';
import { Select } from '@kobalte/core/select';
import ArrowUpRightIcon from '@phosphor/arrow-up-right.svg';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import CopyIcon from '@phosphor/copy.svg';
import EnvelopeIcon from '@phosphor/envelope.svg';
import LinkIcon from '@phosphor/link.svg';
import MagnifyingGlassIcon from '@phosphor/magnifying-glass.svg';
import PlusIcon from '@phosphor/plus.svg';
import SpinnerIcon from '@phosphor/spinner.svg';
import TrashIcon from '@phosphor/trash.svg';
import UsersIcon from '@phosphor/users.svg';
import XIcon from '@phosphor/x.svg';
import { useGithubLinkStatusQuery } from '@queries/auth';
import {
  useJoinTeamMutation,
  useRejectInvitationMutation,
  useUserInvitesQuery,
} from '@queries/team/invitations';
import {
  useDeleteTeamInviteMutation,
  useInviteToTeamMutation,
  useTeamInvitesQuery,
} from '@queries/team/invites';
import { useRemoveUserFromTeamMutation } from '@queries/team/members';
import {
  useCreateTeamWithInvitesMutation,
  useDeleteTeamMutation,
  usePatchTeamMutation,
  useTeamQuery,
  useToggleAutoJoinDomainMutation,
  useToggleNonAdminInvitesMutation,
  useUserTeamsQuery,
} from '@queries/team/teams';
import type { TeamInviteDetails } from '@service-auth/generated/schemas/teamInviteDetails';
import type { TeamMember } from '@service-auth/generated/schemas/teamMember';
import { TeamRole } from '@service-auth/generated/schemas/teamRole';
import {
  Button,
  cn,
  Dialog,
  Panel,
  SegmentedControl,
  ToggleSwitch,
  Tooltip,
} from '@ui';
import {
  createMemo,
  createSignal,
  For,
  Index,
  Match,
  mapArray,
  onCleanup,
  Show,
  Suspense,
  Switch,
} from 'solid-js';
import { z } from 'zod';
import {
  IntegrationRow,
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from './primitives';
import {
  canRemoveTeamMember,
  isTeamAdminOrOwner,
} from './teamMemberPermissions';
import {
  buildTeamTaskAutolinkTargetUrl,
  getTeamSlugError,
  normalizeTeamSlugInput,
} from './teamSlug';

const roleOrder: Record<string, number> = {
  [TeamRole.owner]: 0,
  [TeamRole.admin]: 1,
  [TeamRole.member]: 2,
};

type RoleOption = { value: TeamRole; label: string };

const roleOptions: RoleOption[] = [
  { value: TeamRole.member, label: 'Member' },
  { value: TeamRole.admin, label: 'Admin' },
];

function RoleSelect(props: {
  value: TeamRole;
  onChange: (role: TeamRole) => void;
  disabled?: boolean;
}) {
  const selectedOption = () =>
    roleOptions.find((o) => o.value === props.value) ?? roleOptions[0];

  return (
    <Select<RoleOption>
      options={roleOptions}
      value={selectedOption()}
      onChange={(opt) => opt && props.onChange(opt.value)}
      optionValue="value"
      optionTextValue="label"
      gutter={4}
      placement="bottom-end"
      disabled={props.disabled}
      itemComponent={(itemProps: { item: CollectionNode<RoleOption> }) => (
        <Select.Item
          item={itemProps.item}
          class="flex items-center justify-between gap-2 px-2 py-1.5 text-sm rounded-xs hover:bg-hover outline-none data-highlighted:bg-hover"
        >
          <Select.ItemLabel>{itemProps.item.rawValue.label}</Select.ItemLabel>
          <Select.ItemIndicator>
            <CheckIcon class="size-3" />
          </Select.ItemIndicator>
        </Select.Item>
      )}
    >
      <Select.Trigger
        as={Button}
        class="rounded-xs px-1 py-0.5 text-xs -ml-1 data-expanded:bg-ink/10"
        disabled={props.disabled}
      >
        <Select.Value<RoleOption>>
          {(state) => state.selectedOption().label}
        </Select.Value>
        <CaretDownIcon class="size-3 text-ink-muted shrink-0" />
      </Select.Trigger>
      <Select.Portal>
        <Select.Content class="z-action-menu border border-edge bg-surface rounded shadow-lg min-w-25 p-1">
          <Select.Listbox />
        </Select.Content>
      </Select.Portal>
    </Select>
  );
}

const emailSchema = z.string().email();

type InviteEntry = { email: string };

const EMPTY_INVITE: InviteEntry = { email: '' };

function InviteEntryRow(props: {
  entry: InviteEntry;
  onEmailChange: (email: string) => void;
  onBlur: () => void;
  onRemove: () => void;
  showRemove: boolean;
  error?: string;
}) {
  return (
    <div class="flex flex-col gap-1">
      <div class="flex items-center gap-2">
        <input
          type="text"
          value={props.entry.email}
          onInput={(e) => props.onEmailChange(e.currentTarget.value)}
          onBlur={() => props.onBlur()}
          placeholder="Enter email address"
          class="settings-input flex-1 min-w-0"
          aria-invalid={!!props.error}
        />
        <Show when={props.showRemove}>
          <Tooltip label="Remove">
            <Button
              variant="outline"
              size="icon-sm"
              class="rounded-xs shrink-0 focus:border-accent"
              tabIndex={0}
              onClick={props.onRemove}
            >
              <XIcon class="size-4" />
            </Button>
          </Tooltip>
        </Show>
      </div>
      <Show when={props.error}>
        <p class="text-xs text-failure-ink">{props.error}</p>
      </Show>
    </div>
  );
}

function getEmailError(
  email: string,
  existingEmails: string[],
  excludeIndex?: number
): string | undefined {
  const trimmed = email.trim();
  if (trimmed === '') return undefined;
  if (!emailSchema.safeParse(trimmed).success) return 'Invalid email address';
  const isDuplicate = existingEmails.some(
    (existing, i) =>
      i !== excludeIndex && existing.toLowerCase() === trimmed.toLowerCase()
  );
  if (isDuplicate) return 'Email already added';
  return undefined;
}

function validateInviteEmails(invites: InviteEntry[]): {
  errors: (string | undefined)[];
  hasError: boolean;
} {
  const emails = invites.map((i) => i.email);
  const errors = invites.map((inv, i) => getEmailError(inv.email, emails, i));
  return { errors, hasError: errors.some((e) => e !== undefined) };
}

function InviteEmailsInput(props: {
  invites: InviteEntry[];
  onChange: (invites: InviteEntry[]) => void;
  errors: (string | undefined)[];
  onErrorsChange: (errors: (string | undefined)[]) => void;
}) {
  const existingEmails = () => props.invites.map((i) => i.email);

  const validateEmail = (index: number) => {
    const error = getEmailError(
      props.invites[index]?.email ?? '',
      existingEmails(),
      index
    );
    const next = [...props.errors];
    next[index] = error;
    props.onErrorsChange(next);
    return !error;
  };

  const updateEmail = (index: number, email: string) => {
    const updated = [...props.invites];
    updated[index] = { ...updated[index], email };
    props.onChange(updated);
    if (props.errors[index]) {
      const next = [...props.errors];
      next[index] = undefined;
      props.onErrorsChange(next);
    }
  };

  let containerRef: HTMLDivElement | undefined;

  const addRow = () => {
    props.onChange([...props.invites, { email: '' }]);
    requestAnimationFrame(() => {
      const inputs = containerRef?.querySelectorAll('input[type="text"]');
      const lastInput = inputs?.[inputs.length - 1] as
        | HTMLInputElement
        | undefined;
      lastInput?.focus();
    });
  };

  const removeRow = (index: number) => {
    props.onChange(props.invites.filter((_, i) => i !== index));
    props.onErrorsChange(props.errors.filter((_, i) => i !== index));
  };

  const lastInvite = () => props.invites[props.invites.length - 1];
  const lastError = () => props.errors[props.errors.length - 1];
  const canAddRow = () => {
    const last = lastInvite();
    return last?.email.trim() !== '' && !lastError();
  };

  return (
    <div ref={containerRef} class="flex flex-col gap-2">
      <Show when={props.invites.length > 0}>
        <div class="flex flex-col gap-2 max-h-72 overflow-y-auto">
          <Index each={props.invites}>
            {(entry, index) => (
              <InviteEntryRow
                entry={entry()}
                onEmailChange={(email) => updateEmail(index, email)}
                onBlur={() => validateEmail(index)}
                onRemove={() => removeRow(index)}
                showRemove={props.invites.length > 1}
                error={props.errors[index]}
              />
            )}
          </Index>
        </div>
      </Show>
      <Button
        variant="outline"
        class="rounded-xs w-full justify-center focus:border-accent"
        tabIndex={0}
        disabled={!canAddRow()}
        onClick={addRow}
      >
        <PlusIcon class="size-4" />
        Add another
      </Button>
    </div>
  );
}

function MemberRow(props: {
  member: TeamMember;
  isOwner: boolean;
  isCurrentUser: boolean;
  canManageRemovals: boolean;
  canRemove: boolean;
  onRemove: () => void;
  onRoleChange: (role: TeamRole) => void;
}) {
  const displayName = () => getDisplayName(tryMacroId(props.member.user_id));
  const isMemberOwner = () => props.member.role === TeamRole.owner;
  const email = () => {
    const id = tryMacroId(props.member.user_id);
    return id ? macroIdToEmail(id) : undefined;
  };
  const showEmail = () => {
    const e = email();
    return e && e !== displayName();
  };

  return (
    <div class="flex items-center justify-between gap-2 px-6 py-3 bg-surface">
      <div class="flex items-center gap-3 min-w-0 flex-1">
        <div class="shrink-0">
          <UserIcon id={props.member.user_id} isDeleted={false} size="lg" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="text-sm font-medium text-ink truncate">
            {displayName()}
            {props.isCurrentUser && (
              <span class="text-ink-muted font-normal"> (you)</span>
            )}
          </div>
          <Show when={showEmail()}>
            <div class="text-xs text-ink-muted truncate">{email()}</div>
          </Show>
        </div>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <Show
          when={props.isOwner && !isMemberOwner()}
          fallback={
            <span class="text-xs text-ink-muted capitalize">
              {props.member.role}
            </span>
          }
        >
          <RoleSelect value={props.member.role} onChange={props.onRoleChange} />
        </Show>
        <Show when={props.canManageRemovals}>
          <Show
            when={props.canRemove}
            fallback={
              <Tooltip
                label={
                  isMemberOwner()
                    ? 'Cannot remove team owner'
                    : 'Cannot remove yourself'
                }
              >
                <Button
                  variant="ghost"
                  size="sm"
                  disabled
                  class="rounded-xs opacity-50 cursor-not-allowed"
                >
                  <TrashIcon class="size-4" />
                </Button>
              </Tooltip>
            }
          >
            <Tooltip label="Remove member">
              <Button variant="ghost" size="sm" onClick={props.onRemove}>
                <TrashIcon class="size-4" />
              </Button>
            </Tooltip>
          </Show>
        </Show>
      </div>
    </div>
  );
}

function MemberName(props: { memberId: string }) {
  const displayName = () => getDisplayName(tryMacroId(props.memberId));
  return <span class="font-medium">{displayName()}</span>;
}

function InviteRow(props: {
  invite: TeamInviteDetails;
  canChange: boolean;
  onCancel: () => void;
}) {
  const [copied, setCopied] = createSignal(false);
  let copyResetTimeout: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(copyResetTimeout));
  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(
        `${getWebOrigin()}/app/team-invite?id=${props.invite.id}`
      );
    } catch (err) {
      console.error('Failed to copy to clipboard', err);
      return;
    }
    setCopied(true);
    clearTimeout(copyResetTimeout);
    copyResetTimeout = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div class="flex items-center justify-between gap-2 px-6 py-3 bg-surface">
      <div class="flex items-center gap-3 min-w-0 flex-1">
        <div class="size-8 rounded-full bg-accent/10 flex items-center justify-center shrink-0">
          <EnvelopeIcon class="size-4 text-accent" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="text-sm text-ink truncate">{props.invite.email}</div>
          <div class="text-xs text-ink-muted">
            Invited as {props.invite.team_role} ·{' '}
            {formatRelativeTimestamp(props.invite.created_at, {
              condensed: true,
            })}
          </div>
        </div>
      </div>
      <Show when={props.canChange}>
        <Tooltip label={copied() ? 'Copied' : 'Copy invite link'}>
          <Button
            variant="ghost"
            size="sm"
            class="shrink-0"
            onClick={handleCopyLink}
          >
            <Show when={copied()} fallback={<LinkIcon class="size-4" />}>
              <CheckIcon class="size-4" />
            </Show>
          </Button>
        </Tooltip>
        <Tooltip label="Cancel invite">
          <Button
            variant="ghost"
            size="sm"
            class="shrink-0"
            onClick={props.onCancel}
          >
            <XIcon class="size-4" />
          </Button>
        </Tooltip>
      </Show>
    </div>
  );
}

function InviterName(props: { inviterId: string }) {
  const displayName = () => getDisplayName(tryMacroId(props.inviterId));
  return <span class="font-medium">{displayName()}</span>;
}

function UserInviteRow(props: {
  invite: TeamInviteDetails;
  onAccept: () => void;
  onDecline: () => void;
  isAccepting: boolean;
  isDeclining: boolean;
}) {
  return (
    <div class="flex items-center justify-between gap-3 px-6 py-3 bg-surface">
      <div class="flex items-center gap-3 min-w-0 flex-1">
        <div class="size-8 rounded-full bg-accent/10 flex items-center justify-center shrink-0">
          <EnvelopeIcon class="size-4 text-accent" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="text-sm text-ink">
            <InviterName inviterId={props.invite.invited_by} /> invited you to
            join a team
          </div>
          <div class="text-xs text-ink-muted">as {props.invite.team_role}</div>
        </div>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <Button
          variant="outline"
          class="px-2 py-1 rounded-xs"
          disabled={props.isAccepting || props.isDeclining}
          onClick={props.onDecline}
        >
          <Show when={props.isDeclining} fallback="Decline">
            <SpinnerIcon class="size-4 animate-spin" />
          </Show>
        </Button>
        <Button
          variant="accent"
          class="px-2 py-1 rounded-xs"
          disabled={props.isAccepting || props.isDeclining}
          onClick={props.onAccept}
        >
          <Show when={props.isAccepting} fallback="Join">
            <SpinnerIcon class="size-4 animate-spin" />
          </Show>
        </Button>
      </div>
    </div>
  );
}

function TeamInvites() {
  const userInvitesQuery = useUserInvitesQuery();
  const joinTeamMutation = useJoinTeamMutation();
  const rejectMutation = useRejectInvitationMutation();

  const invites = () => userInvitesQuery.data?.invites ?? [];

  const isAccepting = (inviteId: string) =>
    joinTeamMutation.isPending &&
    joinTeamMutation.variables?.teamInviteId === inviteId;
  const isDeclining = (inviteId: string) =>
    rejectMutation.isPending &&
    rejectMutation.variables?.teamInviteId === inviteId;

  return (
    <SettingsPage title="Team">
      <Show when={invites().length > 0}>
        <SettingsSection
          title="Invitations"
          description="You've been invited to join a team."
        >
          <SettingsCard>
            <For each={invites()}>
              {(invite) => (
                <UserInviteRow
                  invite={invite}
                  onAccept={() =>
                    joinTeamMutation.mutate({ teamInviteId: invite.id })
                  }
                  onDecline={() =>
                    rejectMutation.mutate({ teamInviteId: invite.id })
                  }
                  isAccepting={isAccepting(invite.id)}
                  isDeclining={isDeclining(invite.id)}
                />
              )}
            </For>
          </SettingsCard>
        </SettingsSection>
      </Show>
    </SettingsPage>
  );
}

const TEAM_NAME_MAX_LENGTH = 50;

const teamNameSchema = z
  .string()
  .transform((s) => s.trim())
  .pipe(
    z
      .string()
      .min(1, 'Team name is required')
      .max(TEAM_NAME_MAX_LENGTH, 'Team name is too long')
  );

function CreateTeamDialog(props: { open: boolean; onClose: () => void }) {
  let teamNameInputRef: HTMLInputElement | undefined;
  const [teamName, setTeamName] = createSignal('');
  const [teamNameError, setTeamNameError] = createSignal<string | undefined>(
    undefined
  );
  const [invites, setInvites] = createSignal<InviteEntry[]>([EMPTY_INVITE]);
  const [inviteErrors, setInviteErrors] = createSignal<(string | undefined)[]>(
    []
  );

  const createTeamMutation = useCreateTeamWithInvitesMutation();

  const charCountColor = () => {
    const len = teamName().trim().length;
    if (len > TEAM_NAME_MAX_LENGTH) return 'text-failure-ink';
    if (len > TEAM_NAME_MAX_LENGTH - 10) return 'text-alert-ink';
    return 'text-ink-muted';
  };

  const validateTeamName = () => {
    const result = teamNameSchema.safeParse(teamName());
    const error = result.success ? undefined : result.error.issues[0]?.message;
    setTeamNameError(error);
    return result.success;
  };

  const validateInvites = () => {
    const { errors, hasError } = validateInviteEmails(invites());
    setInviteErrors(errors);
    return !hasError;
  };

  const handleTeamNameChange = (value: string) => {
    setTeamName(value);
    if (teamNameError()) {
      setTeamNameError(undefined);
    }
  };

  const handleCreate = () => {
    const isTeamNameValid = validateTeamName();
    const areInvitesValid = validateInvites();

    if (!isTeamNameValid || !areInvitesValid) {
      return;
    }

    const result = teamNameSchema.safeParse(teamName());
    if (!result.success) return;

    const inviteEntries = invites()
      .filter((i) => i.email.trim() !== '')
      .map((i) => ({ email: i.email.trim() }));

    createTeamMutation.mutate(
      {
        name: result.data,
        invites: inviteEntries.length > 0 ? inviteEntries : undefined,
      },
      { onSuccess: props.onClose }
    );
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => !open && props.onClose()}
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        teamNameInputRef?.focus();
      }}
    >
      <Panel depth={2} class="max-h-[75vh] text-ink rounded-xl">
        <Panel.Header class="px-2 gap-1">
          <Dialog.CloseButton as={Button} variant="ghost" size="icon-sm">
            <XIcon />
          </Dialog.CloseButton>
          <Dialog.Title as="span" class="text-sm font-medium p-0 m-0">
            Create Team
          </Dialog.Title>
        </Panel.Header>
        <Panel.Body class="p-3 flex flex-col gap-3">
          <div class="flex flex-col gap-1">
            <div class="flex items-center justify-between">
              <label class="text-sm text-ink-muted">Team name</label>
              <span class={cn('text-xs', charCountColor())}>
                {teamName().length}/{TEAM_NAME_MAX_LENGTH}
              </span>
            </div>
            <input
              ref={teamNameInputRef}
              type="text"
              value={teamName()}
              onInput={(e) => handleTeamNameChange(e.currentTarget.value)}
              onBlur={() => validateTeamName()}
              placeholder="My Team"
              class="settings-input w-full"
              aria-invalid={!!teamNameError()}
            />
            <Show when={teamNameError()}>
              <p class="text-xs text-failure-ink">{teamNameError()}</p>
            </Show>
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-sm text-ink-muted">
              Invite members (optional)
            </label>
            <InviteEmailsInput
              invites={invites()}
              onChange={setInvites}
              errors={inviteErrors()}
              onErrorsChange={setInviteErrors}
            />
          </div>
          <div class="flex justify-end gap-1 pt-2">
            <Button
              variant="ghost"
              class="rounded-xs"
              disabled={createTeamMutation.isPending}
              onClick={props.onClose}
            >
              Cancel
            </Button>
            <Button
              variant="accent"
              class="rounded-xs"
              disabled={
                createTeamMutation.isPending ||
                !!teamNameError() ||
                inviteErrors().some((e) => e !== undefined)
              }
              onClick={handleCreate}
            >
              <Show when={createTeamMutation.isPending} fallback="Create Team">
                <SpinnerIcon class="size-4 animate-spin" />
              </Show>
            </Button>
          </div>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}

function EmptyTeamState() {
  const [showCreateModal, setShowCreateModal] = createSignal(false);

  return (
    <SettingsPage title="Team">
      <SettingsSection>
        <SettingsCard>
          <div class="flex flex-col items-center justify-center py-12 text-center px-6">
            <div class="size-12 rounded-full bg-accent/10 flex items-center justify-center mb-4">
              <UsersIcon class="size-6 text-accent" />
            </div>
            <h3 class="text-sm font-medium text-ink mb-1">No team yet</h3>
            <p class="text-xs text-ink-muted max-w-xs mb-4">
              Create a team to collaborate with others and manage access
              together.
            </p>
            <Button
              variant="accent"
              class="rounded-xs"
              onClick={() => setShowCreateModal(true)}
            >
              <PlusIcon class="size-4" />
              Create Team
            </Button>
          </div>
        </SettingsCard>
      </SettingsSection>

      <Show when={showCreateModal()}>
        <CreateTeamDialog
          open={showCreateModal()}
          onClose={() => setShowCreateModal(false)}
        />
      </Show>
    </SettingsPage>
  );
}

/** Shared styling for the editable Name/Slug fields in the team-details card.
 *  Narrows on mobile so the field + Save/Cancel cluster fits a phone width. */
/** Width for the editable Name/Slug fields; pairs with the shared `settings-input`
 *  utility. Narrows on mobile so the field + Save/Cancel cluster fits a phone. */
const TEAM_FIELD_CLASS = 'settings-input w-56 mobile:w-32';

/** Disabled field shown to non-owners, with a tooltip explaining why it's locked.
 *  The muted look comes from `settings-input`'s `:disabled` styling. */
function ReadOnlyField(props: { value: string; tooltip: string }) {
  return (
    <Tooltip label={props.tooltip} placement="top">
      <input
        type="text"
        value={props.value}
        disabled
        class={TEAM_FIELD_CLASS}
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
          class="rounded-xs"
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
          class="rounded-xs"
          disabled={props.pending}
          onClick={props.onCancel}
        >
          <XIcon class="size-4" />
        </Button>
      </Tooltip>
    </div>
  );
}

function TeamManagement(props: {
  teamId: string;
  teamName: string;
  teamSlug: string;
  ownerId: string;
}) {
  const userId = useUserId();

  const teamQuery = useTeamQuery(() => props.teamId);
  const invitesQuery = useTeamInvitesQuery(() => props.teamId);
  const githubLink = useGithubLinkStatusQuery();

  const deleteInviteMutation = useDeleteTeamInviteMutation();
  const removeUserMutation = useRemoveUserFromTeamMutation();
  const patchTeamMutation = usePatchTeamMutation();
  const inviteToTeamMutation = useInviteToTeamMutation();
  const deleteTeamMutation = useDeleteTeamMutation();
  const toggleAutoJoinMutation = useToggleAutoJoinDomainMutation();
  const toggleNonAdminInvitesMutation = useToggleNonAdminInvitesMutation();

  const [showDeleteTeamModal, setShowDeleteTeamModal] = createSignal(false);
  const [deleteConfirmation, setDeleteConfirmation] = createSignal('');
  const [showRemoveModal, setShowRemoveModal] = createSignal<TeamMember | null>(
    null
  );
  const [showCancelInviteModal, setShowCancelInviteModal] =
    createSignal<TeamInviteDetails | null>(null);
  const [showInviteModal, setShowInviteModal] = createSignal(false);
  const [invites, setInvites] = createSignal<InviteEntry[]>([EMPTY_INVITE]);
  const [inviteErrors, setInviteErrors] = createSignal<(string | undefined)[]>(
    []
  );
  const [editingTeamName, setEditingTeamName] = createSignal<
    string | undefined
  >(undefined);
  const [editingTeamSlug, setEditingTeamSlug] = createSignal<
    string | undefined
  >(undefined);
  const [teamSlugError, setTeamSlugError] = createSignal<string | undefined>(
    undefined
  );

  const hasValidInvites = () => {
    const inv = invites();
    const hasNonEmptyEmail = inv.some((i) => i.email.trim() !== '');
    const hasNoErrors = !inviteErrors().some((e) => e !== undefined);
    return hasNonEmptyEmail && hasNoErrors;
  };

  const validateInvites = () => {
    const { errors, hasError } = validateInviteEmails(invites());
    setInviteErrors(errors);
    return !hasError;
  };

  const deleteConfirmationPhrase = () => `Delete ${props.teamName}`;
  const canDeleteTeam = () =>
    deleteConfirmation() === deleteConfirmationPhrase();

  const teamNameValue = () => editingTeamName() ?? props.teamName;
  const hasTeamNameChanged = () => {
    const editing = editingTeamName();
    return editing !== undefined && editing.trim() !== props.teamName;
  };

  const teamSlugValue = () => editingTeamSlug() ?? props.teamSlug;
  const hasTeamSlugInputChanged = () => {
    const editing = editingTeamSlug();
    return editing !== undefined && editing !== props.teamSlug;
  };
  const hasTeamSlugChanged = () => {
    const editing = editingTeamSlug();
    return (
      editing !== undefined &&
      normalizeTeamSlugInput(editing) !== props.teamSlug
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

  const members = createMemo(() => {
    const unsorted = teamQuery.data?.members ?? [];
    return [...unsorted].sort((a, b) => {
      const roleCompare = (roleOrder[a.role] ?? 3) - (roleOrder[b.role] ?? 3);
      if (roleCompare !== 0) return roleCompare;
      return a.user_id.localeCompare(b.user_id);
    });
  });

  const [memberQuery, setMemberQuery] = createSignal('');
  // The input stays live (`memberQuery`); filtering reads this debounced view so
  // a burst of typing collapses to one O(n) scan instead of one per keystroke.
  const debouncedMemberQuery = debouncedDependent(memberQuery, 120);

  // Resolve each member's display name reactively. `mapArray` keeps one stable
  // name lookup per member (not recreated on every keystroke / re-render), and
  // disposes it when the member leaves the list.
  const memberSearchIndex = mapArray(members, (member) => {
    const macroId = tryMacroId(member.user_id);
    const displayName = () => getDisplayName(macroId);
    const email = macroId ? macroIdToEmail(macroId) : '';
    // Memoized so the lowercased search string is built once (and only rebuilt
    // when the name resolves), not re-allocated for every member on each scan.
    const haystack = createMemo(() =>
      `${displayName()} ${email}`.toLowerCase()
    );
    return { member, haystack };
  });

  // Only worth showing the filter once the list is long enough to scan.
  const showMemberSearch = () => members().length > 5;

  const filteredMembers = createMemo(() => {
    const q = debouncedMemberQuery().trim().toLowerCase();
    if (!q) return members();
    // Shared uFuzzy-backed filter (ranks by relevance, favoring contiguity).
    return fuzzyFilter(q, memberSearchIndex(), (entry) => entry.haystack()).map(
      (entry) => entry.member
    );
  });

  const currentUserRole = createMemo(() => {
    const currentUserId = userId();
    if (!currentUserId) return undefined;

    return teamQuery.data?.members.find(
      (member) => member.user_id === currentUserId
    )?.role;
  });
  const isAdminOrOwner = () => isTeamAdminOrOwner(currentUserRole());
  const canManageMemberRemovals = () => isAdminOrOwner();
  const isOwner = createMemo(() => {
    const currentUserId = userId();
    if (!currentUserId) return false;
    return props.ownerId === currentUserId;
  });

  // The team's auto-join domain doubles as the toggle state: a string means
  // auto-join is on for that domain, null/undefined means it's off.
  const autoJoinDomain = () => teamQuery.data?.team.auto_join_domain ?? null;
  const autoJoinDescription = () => {
    const domain = autoJoinDomain();
    return domain
      ? `New sign-ups with an @${domain} email automatically join this team.`
      : "Automatically add new sign-ups whose email matches the team owner's domain.";
  };

  const handleToggleAutoJoin = () => {
    if (!props.teamId || toggleAutoJoinMutation.isPending) return;
    toggleAutoJoinMutation.mutate({ teamId: props.teamId });
  };

  // Whether non-admin members may invite. Teams default to true; only the
  // backend response flips it, so missing data reads as the default.
  const allowNonAdminInvites = () =>
    teamQuery.data?.team.allow_non_admin_invites ?? true;

  const handleToggleNonAdminInvites = () => {
    if (!props.teamId || toggleNonAdminInvitesMutation.isPending) return;
    toggleNonAdminInvitesMutation.mutate({ teamId: props.teamId });
  };

  // The team-wide default link-share scope for newly shared items. NONE
  // (stored as null) means link sharing starts off.
  const defaultLinkShare = () =>
    getLinkShareScope(teamQuery.data?.team.default_link_share);

  const handleChangeDefaultLinkShare = (scope: LinkShareScope) => {
    if (!props.teamId || patchTeamMutation.isPending) return;
    if (scope === defaultLinkShare()) return;
    patchTeamMutation.mutate({
      teamId: props.teamId,
      request: { default_link_share: scope === NO_LINK_SHARE ? null : scope },
    });
  };

  const handleSaveTeamName = () => {
    const newName = editingTeamName()?.trim();
    if (!props.teamId || !newName) return;

    // Validate against the same schema as the create flow (e.g. max length)
    // so rename can't push a name the create path would reject.
    const parsed = teamNameSchema.safeParse(newName);
    if (!parsed.success) return;

    patchTeamMutation.mutate(
      { teamId: props.teamId, request: { name: parsed.data } },
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
    if (!props.teamId || editedSlug === undefined) return;
    if (!validateTeamSlug(editedSlug) || !hasTeamSlugChanged()) return;

    // Persist the normalized slug so the saved value matches the "Will save as"
    // preview (and the backend's UPPERCASE_UNDERSCORE format).
    patchTeamMutation.mutate(
      {
        teamId: props.teamId,
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
      props.teamSlug,
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
    if (!props.teamId) return;

    deleteTeamMutation.mutate(
      { teamId: props.teamId },
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

  const handleRemoveMember = () => {
    const member = showRemoveModal();
    if (!props.teamId || !member) return;

    removeUserMutation.mutate(
      { teamId: props.teamId, userId: member.user_id },
      { onSuccess: () => setShowRemoveModal(null) }
    );
  };

  const handleCancelInvite = () => {
    const invite = showCancelInviteModal();
    if (!props.teamId || !invite) return;

    deleteInviteMutation.mutate(
      { teamId: props.teamId, teamInviteId: invite.id },
      { onSuccess: () => setShowCancelInviteModal(null) }
    );
  };

  const handleInvite = () => {
    const currentInvites = invites();
    if (currentInvites.length === 0 || !props.teamId) return;

    if (!validateInvites()) {
      return;
    }

    const inviteEntries = currentInvites
      .filter((i) => i.email.trim() !== '')
      .map((i) => ({ email: i.email.trim() }));

    inviteToTeamMutation.mutate(
      { teamId: props.teamId, request: { invites: inviteEntries } },
      {
        onSuccess: () => {
          setInvites([]);
          setInviteErrors([]);
          setShowInviteModal(false);
        },
      }
    );
  };

  const handleInviteModalClose = (open: boolean) => {
    if (!open) {
      setInvites([EMPTY_INVITE]);
      setInviteErrors([]);
      setShowInviteModal(false);
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
              class="rounded-xs"
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
                    value={props.teamName}
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
                    class={TEAM_FIELD_CLASS}
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
                    value={props.teamSlug}
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
                      class={TEAM_FIELD_CLASS}
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
                  Use <code>{props.teamSlug}-</code> as the reference prefix in
                  GitHub, then paste this target URL.
                </>
              }
              hideDescriptionOnMobile
            >
              <Button
                variant="outline"
                size="sm"
                class="rounded-xs"
                onClick={handleCopyGithubAutolinkUrl}
              >
                <CopyIcon class="size-4" />
                Copy target URL
              </Button>
            </SettingsRow>

            <Show when={isAdminOrOwner()}>
              <SettingsRow
                label="Auto-join on domain"
                description={autoJoinDescription()}
                hideDescriptionOnMobile
              >
                <ToggleSwitch
                  size="md"
                  checked={!!autoJoinDomain()}
                  disabled={
                    toggleAutoJoinMutation.isPending || teamQuery.isLoading
                  }
                  onChange={handleToggleAutoJoin}
                />
              </SettingsRow>

              <SettingsRow
                label="Members can invite"
                description="Let every team member invite people. When off, only admins and the owner can send invites."
                hideDescriptionOnMobile
              >
                <ToggleSwitch
                  size="md"
                  checked={allowNonAdminInvites()}
                  disabled={
                    toggleNonAdminInvitesMutation.isPending ||
                    teamQuery.isLoading
                  }
                  onChange={handleToggleNonAdminInvites}
                />
              </SettingsRow>

              <SettingsRow
                label="Default link sharing"
                description="The link-sharing scope newly shared items start with. None means link sharing starts off."
                hideDescriptionOnMobile
              >
                <SegmentedControl
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

        <SettingsSection title="Connections">
          <SettingsCard>
            <IntegrationRow
              icon={<GithubIcon />}
              title="GitHub App"
              description="Connect your team's repositories for pull request sync."
            >
              {/* The install callback rejects users without a linked GitHub
                  account, so don't offer the flow until they've connected one
                  in their personal settings. */}
              <Show
                when={githubLink.data?.status === 'linked'}
                fallback={
                  <span class="text-xs text-ink-muted">
                    {githubLink.isLoading
                      ? 'Loading…'
                      : 'Connect your GitHub account first'}
                  </span>
                }
              >
                <a
                  href={`${SERVER_HOSTS['document-storage-service']}/github/install-sync`}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-ink-muted outline-none transition-colors hover:bg-ink/4 hover:text-ink focus-visible:bg-ink/6"
                >
                  Configure app
                  <ArrowUpRightIcon class="size-3.5 opacity-70" />
                </a>
              </Show>
            </IntegrationRow>
          </SettingsCard>
        </SettingsSection>

        <SettingsSection
          title="Members"
          actions={
            // Members can invite unless the team has restricted inviting
            // to admins; removals stay admin-only.
            <Show when={isAdminOrOwner() || allowNonAdminInvites()}>
              <Button
                variant="outline"
                size="sm"
                class="rounded-xs"
                onClick={() => setShowInviteModal(true)}
              >
                <PlusIcon class="size-4" />
                Invite
              </Button>
            </Show>
          }
        >
          <Show when={showMemberSearch()}>
            <label class="flex items-center gap-2 h-9 px-3 rounded-lg border border-edge-muted text-ink-muted focus-within:border-accent focus-within:text-ink">
              <MagnifyingGlassIcon class="size-4 shrink-0" />
              <input
                type="text"
                value={memberQuery()}
                onInput={(e) => setMemberQuery(e.currentTarget.value)}
                placeholder="Filter members"
                class="flex-1 min-w-0 bg-transparent text-sm text-ink outline-none placeholder:text-ink-placeholder"
              />
              <Show when={memberQuery()}>
                <button
                  type="button"
                  class="shrink-0 text-ink-muted hover:text-ink"
                  aria-label="Clear filter"
                  onClick={() => setMemberQuery('')}
                >
                  <XIcon class="size-4" />
                </button>
              </Show>
            </label>
          </Show>

          <Show
            when={!teamQuery.isLoading}
            fallback={
              <SettingsCard>
                <div class="animate-pulse bg-skeleton rounded h-16 m-4" />
              </SettingsCard>
            }
          >
            <Show
              when={filteredMembers().length > 0}
              fallback={
                <SettingsCard>
                  <div class="px-6 py-8 text-center text-sm text-ink-muted">
                    No members match “{memberQuery()}”
                  </div>
                </SettingsCard>
              }
            >
              <SettingsCard>
                <For each={filteredMembers()}>
                  {(member) => (
                    <MemberRow
                      member={member}
                      isOwner={isOwner()}
                      isCurrentUser={member.user_id === userId()}
                      canManageRemovals={canManageMemberRemovals()}
                      canRemove={canRemoveTeamMember(
                        userId(),
                        currentUserRole(),
                        member
                      )}
                      onRemove={() => setShowRemoveModal(member)}
                      onRoleChange={(newRole) => {
                        if (!props.teamId) return;
                        patchTeamMutation.mutate({
                          teamId: props.teamId,
                          request: {
                            user_role_updates: [
                              {
                                team_user_id: member.user_id,
                                role: newRole,
                              },
                            ],
                          },
                        });
                      }}
                    />
                  )}
                </For>
              </SettingsCard>
            </Show>
          </Show>
        </SettingsSection>

        <Show
          when={
            (isOwner() || allowNonAdminInvites()) &&
            (invitesQuery.data?.invites?.length ?? 0) > 0
          }
        >
          <SettingsSection title="Pending invites">
            <SettingsCard>
              <For each={invitesQuery.data?.invites ?? []}>
                {(invite) => (
                  <InviteRow
                    invite={invite}
                    canChange={isOwner() || allowNonAdminInvites()}
                    onCancel={() => setShowCancelInviteModal(invite)}
                  />
                )}
              </For>
            </SettingsCard>
          </SettingsSection>
        </Show>
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
              <span class="font-medium">{props.teamName}</span>? This action
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
                class="rounded-xs"
                disabled={deleteTeamMutation.isPending}
                onClick={() => handleDeleteTeamModalClose(false)}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                class="rounded-xs"
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

      <Dialog
        open={!!showRemoveModal()}
        onOpenChange={() => setShowRemoveModal(null)}
      >
        <Panel depth={2} class="max-h-[75vh] text-ink rounded-xl">
          <Panel.Header class="px-2 gap-1">
            <Dialog.CloseButton as={Button} variant="ghost" size="icon-sm">
              <XIcon />
            </Dialog.CloseButton>
            <Dialog.Title as="span" class="text-sm font-medium p-0 m-0">
              Remove Member
            </Dialog.Title>
          </Panel.Header>
          <Panel.Body class="p-3 flex flex-col gap-3">
            <p>
              Are you sure you want to remove{' '}
              <Show when={showRemoveModal()}>
                {(member) => <MemberName memberId={member().user_id} />}
              </Show>{' '}
              from the team?
            </p>
            <div class="flex justify-end gap-1 pt-2">
              <Button
                variant="ghost"
                class="rounded-xs"
                disabled={removeUserMutation.isPending}
                onClick={() => setShowRemoveModal(null)}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                class="rounded-xs"
                disabled={removeUserMutation.isPending}
                onClick={handleRemoveMember}
              >
                <Show when={removeUserMutation.isPending} fallback="Remove">
                  <SpinnerIcon class="size-4 animate-spin" />
                </Show>
              </Button>
            </div>
          </Panel.Body>
        </Panel>
      </Dialog>

      <Dialog
        open={!!showCancelInviteModal()}
        onOpenChange={() => setShowCancelInviteModal(null)}
      >
        <Panel depth={2} class="max-h-[75vh] text-ink rounded-xl">
          <Panel.Header class="px-2 gap-1">
            <Dialog.CloseButton as={Button} variant="ghost" size="icon-sm">
              <XIcon />
            </Dialog.CloseButton>
            <Dialog.Title as="span" class="text-sm font-medium p-0 m-0">
              Cancel Invitation
            </Dialog.Title>
          </Panel.Header>
          <Panel.Body class="p-3 flex flex-col gap-3">
            <p>
              Are you sure you want to cancel the invitation for{' '}
              <span class="font-medium">{showCancelInviteModal()?.email}</span>?
            </p>
            <div class="flex justify-end gap-1 pt-2">
              <Button
                variant="ghost"
                class="rounded-xs"
                disabled={deleteInviteMutation.isPending}
                onClick={() => setShowCancelInviteModal(null)}
              >
                Keep
              </Button>
              <Button
                variant="danger"
                class="rounded-xs"
                disabled={deleteInviteMutation.isPending}
                onClick={handleCancelInvite}
              >
                <Show
                  when={deleteInviteMutation.isPending}
                  fallback="Cancel Invite"
                >
                  <SpinnerIcon class="size-4 animate-spin" />
                </Show>
              </Button>
            </div>
          </Panel.Body>
        </Panel>
      </Dialog>

      <Dialog open={showInviteModal()} onOpenChange={handleInviteModalClose}>
        <Panel depth={2} class="max-h-[75vh] text-ink rounded-xl">
          <Panel.Header class="px-2 gap-1">
            <Dialog.CloseButton as={Button} variant="ghost" size="icon-sm">
              <XIcon />
            </Dialog.CloseButton>
            <Dialog.Title as="span" class="text-sm font-medium p-0 m-0">
              Invite to Team
            </Dialog.Title>
          </Panel.Header>

          <Panel.Body class="p-3 flex flex-col gap-3">
            <InviteEmailsInput
              invites={invites()}
              onChange={setInvites}
              errors={inviteErrors()}
              onErrorsChange={setInviteErrors}
            />
            <div class="flex justify-end gap-1 pt-2">
              <Button
                variant="ghost"
                class="rounded-xs"
                disabled={inviteToTeamMutation.isPending}
                onClick={() => handleInviteModalClose(false)}
              >
                Cancel
              </Button>
              <Button
                variant={hasValidInvites() ? 'accent' : 'ghost'}
                class="rounded-xs"
                disabled={!hasValidInvites() || inviteToTeamMutation.isPending}
                onClick={handleInvite}
              >
                <Show
                  when={inviteToTeamMutation.isPending}
                  fallback={
                    invites().length > 1
                      ? `Send ${invites().length} Invites`
                      : 'Send Invite'
                  }
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

function TeamContent() {
  const userTeamsQuery = useUserTeamsQuery();
  const userInvitesQuery = useUserInvitesQuery();

  const team = createMemo(() => {
    const teams = userTeamsQuery.data;
    if (!teams || teams.length === 0) return null;
    return teams[0];
  });

  const hasInvites = () => (userInvitesQuery.data?.invites?.length ?? 0) > 0;

  return (
    <Switch>
      <Match when={team()} keyed>
        {(t) => (
          <TeamManagement
            teamId={t.id}
            teamName={t.name}
            teamSlug={t.slug}
            ownerId={t.owner_id}
          />
        )}
      </Match>
      <Match when={hasInvites()}>
        <TeamInvites />
      </Match>
      <Match when={true}>
        <EmptyTeamState />
      </Match>
    </Switch>
  );
}

export function Team() {
  return (
    // Each state renders its own SettingsPage (scrolling, centered column) so
    // Team matches the Account/Appearance layout.
    <Suspense
      fallback={<div class="animate-pulse bg-skeleton rounded h-4 w-32 m-6" />}
    >
      <TeamContent />
    </Suspense>
  );
}
