import { CustomScrollbar } from '@core/component/CustomScrollbar';
import { UserIcon } from '@core/component/UserIcon';
import { VList } from 'virtua/solid';
import PlusIcon from '@phosphor/plus.svg';
import UsersIcon from '@phosphor/users.svg';
import TrashIcon from '@phosphor/trash.svg';
import SpinnerIcon from '@phosphor/spinner.svg';
import EnvelopeIcon from '@phosphor/envelope.svg';
import XIcon from '@phosphor/x.svg';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import MagnifyingGlassIcon from '@phosphor/magnifying-glass.svg';
import InfoIcon from '@phosphor/info.svg';

import { Tooltip } from '@ui';
import { Button } from '@ui';
import { Dialog, Panel } from '@ui';
import { cn } from '@ui';
import { Select } from '@kobalte/core/select';
import { useUserId } from '@core/context/user';
import { useDisplayName, tryMacroId, macroIdToEmail } from '@core/user';
import {
  createMemo,
  createSignal,
  For,
  Index,
  type JSX,
  mapArray,
  Match,
  Show,
  Suspense,
  Switch,
} from 'solid-js';
import type { CollectionNode } from '@kobalte/core';
import {
  useUserTeamsQuery,
  useTeamQuery,
  usePatchTeamMutation,
  useDeleteTeamMutation,
  useCreateTeamWithInvitesMutation,
} from '@queries/team/teams';
import {
  useTeamInvitesQuery,
  useDeleteTeamInviteMutation,
  useInviteToTeamMutation,
} from '@queries/team/invites';
import {
  useUserInvitesQuery,
  useJoinTeamMutation,
  useRejectInvitationMutation,
} from '@queries/team/invitations';
import { useRemoveUserFromTeamMutation } from '@queries/team/members';
import { TeamRole } from '@service-auth/generated/schemas/teamRole';
import type { TeamMember } from '@service-auth/generated/schemas/teamMember';
import type { TeamInviteDetails } from '@service-auth/generated/schemas/teamInviteDetails';
import { formatRelativeTimestamp } from '@entity';
import { useHasPaidAccess } from '@core/auth/license';
import { usePaywallState } from '@core/constant/PaywallState';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { z } from 'zod';
import { getTeamSlugError, normalizeTeamSlugInput } from './teamSlug';
import { debouncedDependent } from '@core/util/debounce';
import { fuzzyFilter } from '@core/util/fuzzy';

function useRequiresPaidUpgrade() {
  const hasPaidAccess = useHasPaidAccess();
  const newPricingFlag = useFeatureFlag('enable-new-pricing');
  return createMemo(() => newPricingFlag().enabled && !hasPaidAccess());
}

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
        <Select.Content class="z-50 bg-surface ring-1 ring-edge rounded shadow-lg min-w-25 p-1">
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
          class={cn(
            'flex-1 min-w-0 px-3 py-2 text-sm border rounded-lg bg-surface text-ink placeholder:text-ink/30 outline-none',
            props.error
              ? 'border-failure focus:border-failure'
              : 'border-edge-muted focus:border-accent'
          )}
        />
        <Show when={props.showRemove}>
          <Tooltip label="Remove">
            <Button
              variant="base"
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
        variant="base"
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
  isLast?: boolean;
  onRemove: () => void;
  onRoleChange: (role: TeamRole) => void;
}) {
  const [displayName] = useDisplayName(tryMacroId(props.member.user_id));
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
    <div
      class={cn(
        'flex items-center justify-between py-2 px-6 gap-2 bg-surface hover:bg-hover',
        !props.isLast && 'settings-row-divider'
      )}
    >
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
        <Show when={props.isOwner}>
          <Show
            when={!props.isCurrentUser && !isMemberOwner()}
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
  const [displayName] = useDisplayName(tryMacroId(props.memberId));
  return <span class="font-medium">{displayName()}</span>;
}

function InviteRow(props: {
  invite: TeamInviteDetails;
  isOwner: boolean;
  onCancel: () => void;
}) {
  return (
    <div class="flex items-center justify-between py-2 border-b border-edge-muted last:border-b-0 gap-2">
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
      <Show when={props.isOwner}>
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
  const [displayName] = useDisplayName(tryMacroId(props.inviterId));
  return <span class="font-medium">{displayName()}</span>;
}

function UserInviteRow(props: {
  invite: TeamInviteDetails;
  onAccept: () => void;
  onDecline: () => void;
  isAccepting: boolean;
  isDeclining: boolean;
  requiresUpgrade: boolean;
  onUpgrade: () => void;
}) {
  return (
    <div class="flex items-center justify-between py-3 border-b border-edge-muted last:border-b-0 gap-3">
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
          variant="base"
          class="px-2 py-1 rounded-xs"
          disabled={props.isAccepting || props.isDeclining}
          onClick={props.onDecline}
        >
          <Show when={props.isDeclining} fallback="Decline">
            <SpinnerIcon class="size-4 animate-spin" />
          </Show>
        </Button>
        <Button
          variant="active"
          class="px-2 py-1 rounded-xs"
          disabled={props.isAccepting || props.isDeclining}
          tooltip={
            props.requiresUpgrade
              ? 'Joining a team requires a paid plan'
              : undefined
          }
          onClick={props.requiresUpgrade ? props.onUpgrade : props.onAccept}
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
  const requiresUpgrade = useRequiresPaidUpgrade();
  const { showPaywall } = usePaywallState();

  const invites = () => userInvitesQuery.data?.invites ?? [];

  const isAccepting = (inviteId: string) =>
    joinTeamMutation.isPending &&
    joinTeamMutation.variables?.teamInviteId === inviteId;
  const isDeclining = (inviteId: string) =>
    rejectMutation.isPending &&
    rejectMutation.variables?.teamInviteId === inviteId;

  return (
    <Panel depth={2} class="h-full overflow-hidden text-ink">
      <Panel.Header class="px-6">
        <div class="text-sm font-semibold">Team</div>
      </Panel.Header>
      <Panel.Body>
        <Show when={invites().length > 0}>
          <section class="px-6 py-4">
            <header class="mb-2">
              <h3 class="text-sm font-medium">
                You've been invited to join a team
              </h3>
            </header>
            <div class="border border-edge rounded-sm px-3">
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
                    requiresUpgrade={requiresUpgrade()}
                    onUpgrade={() => showPaywall()}
                  />
                )}
              </For>
            </div>
          </section>
        </Show>
      </Panel.Body>
    </Panel>
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
  const requiresUpgrade = useRequiresPaidUpgrade();

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
      <Panel depth={2} active class="max-h-[75vh] text-ink rounded-xl">
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
              class={cn(
                'w-full px-3 py-2 text-sm border rounded-lg bg-surface text-ink placeholder:text-ink/30 outline-none',
                teamNameError()
                  ? 'border-failure focus:border-failure'
                  : 'border-edge-muted focus:border-accent'
              )}
            />
            <Show when={teamNameError()}>
              <p class="text-xs text-failure-ink">{teamNameError()}</p>
            </Show>
          </div>
          <Show when={!requiresUpgrade()}>
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
          </Show>
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
              variant="active"
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
  const hasPaidAccess = useHasPaidAccess();
  const { showPaywall } = usePaywallState();

  return (
    <>
      <Panel depth={2} class="h-full overflow-hidden text-ink">
        <Panel.Header class="px-6">
          <div class="text-sm font-semibold">Team</div>
        </Panel.Header>
        <Panel.Body>
          <div class="flex flex-col items-center justify-center py-12 text-center px-6">
            <div class="size-12 rounded-full bg-accent/10 flex items-center justify-center mb-4">
              <UsersIcon class="size-6 text-accent" />
            </div>
            <h3 class="text-sm font-medium text-ink mb-1">No team yet</h3>
            <Show
              when={hasPaidAccess()}
              fallback={
                <>
                  <p class="text-xs text-ink-muted max-w-xs mb-4">
                    Teams are available on paid plans. Upgrade to create and
                    manage teams.
                  </p>
                  <Button
                    variant="active"
                    class="rounded-xs"
                    onClick={() => showPaywall()}
                  >
                    Upgrade
                  </Button>
                </>
              }
            >
              <p class="text-xs text-ink-muted max-w-xs mb-4">
                Create a team to collaborate with others and manage access
                together.
              </p>
              <Button
                variant="active"
                class="rounded-xs"
                onClick={() => setShowCreateModal(true)}
              >
                <PlusIcon class="size-4" />
                Create Team
              </Button>
            </Show>
          </div>
        </Panel.Body>
      </Panel>

      <Show when={showCreateModal()}>
        <CreateTeamDialog
          open={showCreateModal()}
          onClose={() => setShowCreateModal(false)}
        />
      </Show>
    </>
  );
}

/** Shared styling for the editable Name/Slug fields in the team-details card. */
const TEAM_FIELD_CLASS =
  'w-48 h-8 px-2.5 rounded-lg border bg-surface text-sm text-ink outline-none focus:border-accent';

/** A team-details row: label + info tooltip on the left, its control on the right. */
function MetadataRow(props: {
  label: string;
  hint: string;
  children: JSX.Element;
}) {
  return (
    <div class="flex items-center gap-3 w-full px-4 py-2">
      <div class="flex items-center gap-1.5 min-w-0">
        <span class="text-sm">{props.label}</span>
        <Tooltip label={props.hint} placement="top">
          <InfoIcon class="size-3.5 text-ink-muted hover:text-ink" />
        </Tooltip>
      </div>
      {props.children}
    </div>
  );
}

/** Disabled field shown to non-owners, with a tooltip explaining why it's locked. */
function ReadOnlyField(props: { value: string; tooltip: string }) {
  return (
    <Tooltip label={props.tooltip} placement="top">
      <input
        type="text"
        value={props.value}
        disabled
        class={cn(
          TEAM_FIELD_CLASS,
          'border-edge-muted text-ink-muted pointer-events-none opacity-70'
        )}
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
          variant="active"
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

  const deleteInviteMutation = useDeleteTeamInviteMutation();
  const removeUserMutation = useRemoveUserFromTeamMutation();
  const patchTeamMutation = usePatchTeamMutation();
  const inviteToTeamMutation = useInviteToTeamMutation();
  const deleteTeamMutation = useDeleteTeamMutation();
  const requiresUpgrade = useRequiresPaidUpgrade();
  const { showPaywall } = usePaywallState();

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

  const [memberListWrapperRef, setMemberListWrapperRef] =
    createSignal<HTMLDivElement>();
  const memberListScrollContainer = () => {
    const el = memberListWrapperRef();
    if (!el) return undefined;
    return (
      (el.querySelector(
        '[data-team-members-list-container]'
      ) as HTMLElement | null) ?? undefined
    );
  };

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
    const [displayName] = useDisplayName(macroId);
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

  const isOwner = createMemo(() => {
    const currentUserId = userId();
    if (!currentUserId) return false;
    return props.ownerId === currentUserId;
  });

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
      <div
        class="grid size-full min-h-0 gap-2"
        style={{ 'grid-template-rows': 'min-content minmax(0, 1fr)' }}
      >
        <Panel depth={2} class="overflow-hidden text-ink">
          <Panel.Header class="justify-between px-6">
            <div class="text-sm font-semibold">Team</div>
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
          </Panel.Header>
          <Panel.Body class="@container">
            <div class="grid grid-cols-1 items-start gap-2 px-2 py-2 @[680px]:grid-cols-2">
              <MetadataRow
                label="Name"
                hint="What your team is called — shown in invitations and billing."
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
                          if (
                            hasTeamNameChanged() &&
                            editingTeamName()?.trim()
                          ) {
                            handleSaveTeamName();
                          }
                        } else if (e.key === 'Escape') {
                          handleCancelTeamNameEdit();
                          e.currentTarget.blur();
                        }
                      }}
                      placeholder="Enter team name"
                      class={cn(TEAM_FIELD_CLASS, 'border-edge-muted')}
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
              </MetadataRow>
              <MetadataRow
                label="Slug"
                hint="Short code in task references like ENG-42 (GitHub, branch names)."
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
                        classList={{
                          'border-failure': !!teamSlugError(),
                          'border-edge-muted': !teamSlugError(),
                        }}
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
              </MetadataRow>
            </div>
          </Panel.Body>
        </Panel>

        <Panel depth={2} class="min-h-0 overflow-hidden text-ink">
          <Panel.Header class="justify-between px-6">
            <div class="text-sm font-semibold">Members</div>
            <Show when={isOwner()}>
              <Button
                variant="base"
                size="sm"
                class="rounded-xs"
                tooltip={
                  requiresUpgrade()
                    ? 'Inviting members requires a paid plan'
                    : undefined
                }
                onClick={() =>
                  requiresUpgrade() ? showPaywall() : setShowInviteModal(true)
                }
              >
                <PlusIcon class="size-4" />
                Invite
              </Button>
            </Show>
          </Panel.Header>
          <Panel.Body>
            <div class="flex h-full flex-col">
              <Show when={showMemberSearch()}>
                <div class="px-6 py-2 shrink-0">
                  <label class="flex items-center gap-2 h-8 px-2.5 rounded-lg border border-edge-muted text-ink-muted focus-within:border-accent focus-within:text-ink">
                    <MagnifyingGlassIcon class="size-4 shrink-0" />
                    <input
                      type="text"
                      value={memberQuery()}
                      onInput={(e) => setMemberQuery(e.currentTarget.value)}
                      placeholder="Filter members"
                      class="flex-1 min-w-0 bg-transparent text-sm text-ink outline-none placeholder:text-ink-extra-muted"
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
                </div>
              </Show>

              <div class="relative min-h-0 flex-1">
                <Show
                  when={!teamQuery.isLoading}
                  fallback={
                    <div class="animate-pulse bg-ink-extra-muted rounded h-16" />
                  }
                >
                  <Show
                    when={filteredMembers().length > 0}
                    fallback={
                      <div class="flex justify-center px-6 pt-4 text-center text-sm text-ink-muted">
                        No members match “{memberQuery()}”
                      </div>
                    }
                  >
                    <div
                      ref={setMemberListWrapperRef}
                      class="relative h-full min-h-0"
                    >
                      <VList
                        data={filteredMembers()}
                        class="h-full scrollbar-hidden"
                        style={{
                          height: '100%',
                          width: '100%',
                        }}
                        bufferSize={500}
                        data-team-members-list-container
                      >
                        {(member, index) => (
                          <MemberRow
                            member={member}
                            isOwner={isOwner()}
                            isCurrentUser={member.user_id === userId()}
                            isLast={index() === filteredMembers().length - 1}
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
                      </VList>
                      <CustomScrollbar
                        scrollContainer={memberListScrollContainer}
                      />
                    </div>
                  </Show>
                </Show>
              </div>

              <Show
                when={
                  isOwner() && (invitesQuery.data?.invites?.length ?? 0) > 0
                }
              >
                <section class="px-6 py-4 border-t border-edge-muted shrink-0">
                  <h3 class="text-sm font-medium mb-2">Pending Invites</h3>
                  <div class="border border-edge rounded-sm px-3">
                    <For each={invitesQuery.data?.invites ?? []}>
                      {(invite) => (
                        <InviteRow
                          invite={invite}
                          isOwner={isOwner()}
                          onCancel={() => setShowCancelInviteModal(invite)}
                        />
                      )}
                    </For>
                  </div>
                </section>
              </Show>
            </div>
          </Panel.Body>
        </Panel>
      </div>

      <Dialog
        open={showDeleteTeamModal()}
        onOpenChange={handleDeleteTeamModalClose}
      >
        <Panel depth={2} active class="max-h-[75vh] text-ink rounded-xl">
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
              class="w-full px-3 py-2 text-sm border border-edge-muted rounded-lg bg-surface text-ink placeholder:text-ink/30 outline-none focus:border-accent"
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
        <Panel depth={2} active class="max-h-[75vh] text-ink rounded-xl">
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
        <Panel depth={2} active class="max-h-[75vh] text-ink rounded-xl">
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
        <Panel depth={2} active class="max-h-[75vh] text-ink rounded-xl">
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
                variant={hasValidInvites() ? 'active' : 'ghost'}
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
    <div class="h-full overflow-hidden flex justify-center p-2">
      <div class="max-w-200 size-full">
        {/* Each state renders its own Panel(s): TeamManagement is a two-card
            layout (details + members); the others are a single card. */}
        <Suspense
          fallback={
            <div class="animate-pulse bg-ink-extra-muted rounded h-4 w-32 m-6" />
          }
        >
          <TeamContent />
        </Suspense>
      </div>
    </div>
  );
}
