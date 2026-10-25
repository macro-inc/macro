import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { useUserId } from '@core/context/user';
import { getDisplayName, tryMacroId } from '@core/user';
import EnvelopeIcon from '@phosphor/envelope.svg';
import PlusIcon from '@phosphor/plus.svg';
import SpinnerIcon from '@phosphor/spinner.svg';
import UsersIcon from '@phosphor/users.svg';
import XIcon from '@phosphor/x.svg';
import {
  useJoinTeamMutation,
  useRejectInvitationMutation,
  useUserInvitesQuery,
} from '@queries/team/invitations';
import { useInviteToTeamMutation } from '@queries/team/invites';
import {
  useCreateTeamWithInvitesMutation,
  useTeamQuery,
  useUserTeamsQuery,
} from '@queries/team/teams';
import type { Team as TeamSummary } from '@service-auth/generated/schemas/team';
import type { TeamInviteDetails } from '@service-auth/generated/schemas/teamInviteDetails';
import { Button, cn, Dialog, Panel, Tooltip } from '@ui';
import {
  type Accessor,
  createMemo,
  createSignal,
  For,
  Index,
  type JSX,
  Match,
  Show,
  Suspense,
  Switch,
} from 'solid-js';
import { z } from 'zod';
import { SettingsCard, SettingsPage, SettingsSection } from './primitives';
import { TeamInviteLinkSection } from './TeamInviteLinkSection';
import { isTeamAdminOrOwner } from './teamMemberPermissions';

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
              class="shrink-0 focus:border-accent"
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
        class="w-full justify-center focus:border-accent"
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
    <div class="flex items-center justify-between gap-3 px-4 py-4">
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
          class="px-2 py-1"
          disabled={props.isAccepting || props.isDeclining}
          onClick={props.onDecline}
        >
          <Show when={props.isDeclining} fallback="Decline">
            <SpinnerIcon class="size-4 animate-spin" />
          </Show>
        </Button>
        <Button
          variant="accent"
          class="px-2 py-1"
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

export const teamNameSchema = z
  .string()
  .transform((s) => s.trim())
  .pipe(
    z
      .string()
      .min(1, 'Team name is required')
      .max(TEAM_NAME_MAX_LENGTH, 'Team name is too long')
  );

export function CreateTeamDialog(props: {
  open: boolean;
  onClose: () => void;
}) {
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
              disabled={createTeamMutation.isPending}
              onClick={props.onClose}
            >
              Cancel
            </Button>
            <Button
              variant="strong"
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

/** Invite people to an existing team by email. */
export function InviteToTeamDialog(props: {
  teamId: string;
  /** Team admins and owners may reset or turn off the invite link. */
  canManageLink: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const inviteToTeamMutation = useInviteToTeamMutation();
  const [invites, setInvites] = createSignal<InviteEntry[]>([EMPTY_INVITE]);
  const [inviteErrors, setInviteErrors] = createSignal<(string | undefined)[]>(
    []
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

  const close = () => {
    setInvites([EMPTY_INVITE]);
    setInviteErrors([]);
    props.onClose();
  };

  const handleInvite = () => {
    if (!validateInvites()) return;

    const inviteEntries = invites()
      .filter((i) => i.email.trim() !== '')
      .map((i) => ({ email: i.email.trim() }));
    if (inviteEntries.length === 0) return;

    inviteToTeamMutation.mutate(
      { teamId: props.teamId, request: { invites: inviteEntries } },
      { onSuccess: close }
    );
  };

  return (
    <Dialog open={props.open} onOpenChange={(open) => !open && close()}>
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
          <TeamInviteLinkSection
            teamId={props.teamId}
            canManage={props.canManageLink}
          />
          <div class="h-px bg-edge-muted" />
          <div class="text-sm text-ink">Invite by email</div>
          <InviteEmailsInput
            invites={invites()}
            onChange={setInvites}
            errors={inviteErrors()}
            onErrorsChange={setInviteErrors}
          />
          <div class="flex justify-end gap-1 pt-2">
            <Button
              variant="ghost"
              disabled={inviteToTeamMutation.isPending}
              onClick={close}
            >
              Cancel
            </Button>
            <Button
              variant="strong"
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
            <Button variant="accent" onClick={() => setShowCreateModal(true)}>
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

/** The viewer's standing on a team, shared by the team settings pages. */
export function useTeamViewer(team: Accessor<TeamSummary>) {
  const userId = useUserId();
  const teamQuery = useTeamQuery(() => team().id);
  const role = createMemo(() => {
    const currentUserId = userId();
    if (!currentUserId) return undefined;

    return teamQuery.data?.members.find(
      (member) => member.user_id === currentUserId
    )?.role;
  });
  return {
    teamQuery,
    role,
    isOwner: () => !!userId() && team().owner_id === userId(),
    isAdminOrOwner: () => isTeamAdminOrOwner(role()),
    // Teams default to letting members invite; only the backend response
    // flips it, so missing data reads as the default.
    allowNonAdminInvites: () =>
      teamQuery.data?.team.allow_non_admin_invites ?? true,
  };
}

function TeamContent(props: { children: (team: TeamSummary) => JSX.Element }) {
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
        {(t) => props.children(t)}
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

/**
 * Frame for every page in the Team settings group: renders the page for the
 * viewer's team, or their pending invitations / the create-team prompt when
 * they don't have one.
 */
export function TeamPage(props: {
  children: (team: TeamSummary) => JSX.Element;
}) {
  return (
    // Each state renders its own SettingsPage (scrolling, centered column) so
    // Team matches the Account/Appearance layout.
    <Suspense fallback={<ListSkeleton.Bar class="m-6 h-4 w-32" />}>
      <TeamContent>{props.children}</TeamContent>
    </Suspense>
  );
}
