import { UserIcon } from '@core/component/UserIcon';
import LeaveIcon from '@icon/regular/sign-out.svg';
import PlusIcon from '@icon/regular/plus.svg';
import TrashIcon from '@icon/regular/trash.svg';
import SpinnerIcon from '@icon/regular/spinner.svg';
import EnvelopeIcon from '@icon/regular/envelope.svg';
import XIcon from '@icon/regular/x.svg';
import CaretDownIcon from '@icon/regular/caret-down.svg';
import CheckIcon from '@icon/regular/check.svg';
import { DialogWrapper } from '@core/component/DialogWrapper';
import { Tooltip } from '@core/component/Tooltip';
import { Button } from '@ui/components/Button';
import { Dialog } from '@kobalte/core/dialog';
import { Select } from '@kobalte/core/select';
import { useUserId } from '@core/context/user';
import { useDisplayName, tryMacroId } from '@core/user';
import { createMemo, createSignal, For, Match, Show, Suspense, Switch } from 'solid-js';
import type { CollectionNode } from '@kobalte/core';
import {
  useUserTeamsQuery,
  useTeamQuery,
  usePatchTeamMutation,
  useDeleteTeamMutation,
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
import { useRemoveUserFromTeamMutation, usePatchTeamUserTierMutation } from '@queries/team/members';
import { TeamRole } from '@service-auth/generated/schemas/teamRole';
import { TeamUserTier } from '@service-auth/generated/schemas/teamUserTier';
import type { TeamMember } from '@service-auth/generated/schemas/teamMember';
import type { TeamInviteDetails } from '@service-auth/generated/schemas/teamInviteDetails';
import { formatRelativeTimestamp } from '@entity';
import { z } from 'zod';

const roleOrder: Record<string, number> = {
  [TeamRole.owner]: 0,
  [TeamRole.admin]: 1,
  [TeamRole.member]: 2,
};

type TierOption = { value: TeamUserTier; label: string };

const tierOptions: TierOption[] = [
  { value: TeamUserTier.Haiku, label: 'Haiku' },
  { value: TeamUserTier.Sonnet, label: 'Sonnet' },
  { value: TeamUserTier.Opus, label: 'Opus' },
];

function TierSelect(props: { value: string; onChange: (tier: TeamUserTier) => void }) {
  const selectedOption = () => tierOptions.find((o) => o.value === props.value) ?? tierOptions[0];

  return (
    <Select<TierOption>
      options={tierOptions}
      value={selectedOption()}
      onChange={(opt) => opt && props.onChange(opt.value)}
      optionValue="value"
      optionTextValue="label"
      gutter={4}
      placement="bottom-end"
      itemComponent={(itemProps: { item: CollectionNode<TierOption> }) => (
        <Select.Item
          item={itemProps.item}
          class="flex items-center justify-between gap-2 px-2 py-1.5 text-sm rounded-xs hover:bg-hover cursor-pointer outline-none data-highlighted:bg-hover bracket-never"
        >
          <Select.ItemLabel>{itemProps.item.rawValue.label}</Select.ItemLabel>
          <Select.ItemIndicator>
            <CheckIcon class="w-3 h-3" />
          </Select.ItemIndicator>
        </Select.Item>
      )}
    >
      <Select.Trigger as={Button} class="rounded-xs">
        <Select.Value<TierOption>>{(state) => state.selectedOption().label}</Select.Value>
        <CaretDownIcon class="w-3 h-3 text-ink-muted" />
      </Select.Trigger>
      <Select.Portal>
        <Select.Content class="z-50 bg-menu border border-edge rounded shadow-lg min-w-[100px] p-1">
          <Select.Listbox />
        </Select.Content>
      </Select.Portal>
    </Select>
  );
}

const emailSchema = z.string().email();

function parseEmails(raw: string): string[] {
  return raw
    .split(/[,\n\s]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .filter((s) => emailSchema.safeParse(s).success);
}

function MemberRow(props: {
  member: TeamMember;
  isOwner: boolean;
  isCurrentUser: boolean;
  onRemove: () => void;
  onTierChange: (tier: TeamUserTier) => void;
}) {
  const [displayName] = useDisplayName(tryMacroId(props.member.user_id));

  return (
    <div class="flex items-center justify-between py-2 border-b border-edge-muted last:border-b-0 gap-2">
      <div class="flex items-center gap-3 min-w-0 flex-1">
        <div class="shrink-0">
          <UserIcon id={props.member.user_id} isDeleted={false} size="md" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="text-sm font-medium text-ink truncate">
            {displayName()}
            {props.isCurrentUser && <span class="text-ink-muted font-normal"> (you)</span>}
          </div>
          <div class="text-xs text-ink-muted">{props.member.role}</div>
        </div>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <Show
          when={props.isOwner}
          fallback={<span class="text-xs text-ink-muted">{props.member.tier}</span>}
        >
          <TierSelect value={props.member.tier} onChange={props.onTierChange} />
        </Show>
        <Show when={props.isOwner}>
          <Show
            when={!props.isCurrentUser && props.member.role !== TeamRole.owner}
            fallback={
              <Tooltip tooltip={props.member.role === TeamRole.owner ? "Cannot remove team owner" : "Cannot remove yourself"}>
                <Button variant="ghost" size="sm" disabled class="rounded-xs opacity-50 cursor-not-allowed">
                  <TrashIcon class="w-4 h-4" />
                </Button>
              </Tooltip>
            }
          >
            <Tooltip tooltip="Remove member">
              <Button variant="ghost" size="sm" onClick={props.onRemove}>
                <TrashIcon class="w-4 h-4" />
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
    <div class="flex items-center justify-between py-2 border-b border-edge-muted last:border-b-0">
      <div class="flex items-center gap-3 min-w-0 flex-1">
        <div class="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center shrink-0">
          <EnvelopeIcon class="size-4 text-accent" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="text-sm text-ink truncate">{props.invite.email}</div>
          <div class="text-xs text-ink-muted">
            Invited as {props.invite.team_role} · {formatRelativeTimestamp(props.invite.created_at, { condensed: true })}
          </div>
        </div>
      </div>
      <Show when={props.isOwner}>
        <Tooltip tooltip="Cancel invite">
          <Button variant="ghost" size="sm" class="shrink-0" onClick={props.onCancel}>
            <XIcon class="w-4 h-4" />
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
}) {
  return (
    <div class="flex items-center justify-between py-3 border-b border-edge-muted last:border-b-0 gap-3">
      <div class="flex items-center gap-3 min-w-0 flex-1">
        <div class="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center shrink-0">
          <EnvelopeIcon class="size-4 text-accent" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="text-sm text-ink">
            <InviterName inviterId={props.invite.invited_by} /> invited you to join a team
          </div>
          <div class="text-xs text-ink-muted">
            as {props.invite.team_role}
          </div>
        </div>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <Button
          variant="tertiary"
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
    joinTeamMutation.isPending && joinTeamMutation.variables?.teamInviteId === inviteId;
  const isDeclining = (inviteId: string) =>
    rejectMutation.isPending && rejectMutation.variables?.teamInviteId === inviteId;

  return (
    <Show when={invites().length > 0}>
      <section class="mb-6">
        <header class="mb-2">
          <h3 class="text-sm font-medium">Pending Invitations</h3>
          <p class="text-xs text-ink-muted">You've been invited to join a team.</p>
        </header>
        <div class="border border-edge rounded-sm px-3">
          <For each={invites()}>
            {(invite) => (
              <UserInviteRow
                invite={invite}
                onAccept={() => joinTeamMutation.mutate({ teamInviteId: invite.id })}
                onDecline={() => rejectMutation.mutate({ teamInviteId: invite.id })}
                isAccepting={isAccepting(invite.id)}
                isDeclining={isDeclining(invite.id)}
              />
            )}
          </For>
        </div>
      </section>
    </Show>
  );
}

function EmptyTeamState() {
  return (
    <div class="flex flex-col items-center justify-center py-12 text-center">
      <div class="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center mb-4">
        <PlusIcon class="size-6 text-accent" />
      </div>
      <h3 class="text-sm font-medium text-ink mb-1">No team yet</h3>
      <p class="text-xs text-ink-muted max-w-xs">
        You're not part of a team. When someone invites you to join their team, you'll see the invitation here.
      </p>
    </div>
  );
}

function TeamManagement(props: { teamId: string; teamName: string; ownerId: string }) {
  const userId = useUserId();

  const teamQuery = useTeamQuery(() => props.teamId);
  const invitesQuery = useTeamInvitesQuery(() => props.teamId);

  const deleteInviteMutation = useDeleteTeamInviteMutation();
  const removeUserMutation = useRemoveUserFromTeamMutation();
  const patchTeamMutation = usePatchTeamMutation();
  const patchTierMutation = usePatchTeamUserTierMutation();
  const inviteToTeamMutation = useInviteToTeamMutation();
  const deleteTeamMutation = useDeleteTeamMutation();

  const [showLeaveModal, setShowLeaveModal] = createSignal(false);
  const [showDeleteTeamModal, setShowDeleteTeamModal] = createSignal(false);
  const [deleteConfirmation, setDeleteConfirmation] = createSignal('');
  const [showRemoveModal, setShowRemoveModal] = createSignal<TeamMember | null>(null);
  const [showCancelInviteModal, setShowCancelInviteModal] = createSignal<TeamInviteDetails | null>(null);
  const [showInviteModal, setShowInviteModal] = createSignal(false);
  const [inviteEmails, setInviteEmails] = createSignal('');
  const [editingTeamName, setEditingTeamName] = createSignal<string | undefined>(undefined);

  const parsedEmails = () => parseEmails(inviteEmails());
  const hasValidEmails = () => parsedEmails().length > 0;

  const deleteConfirmationPhrase = () => `Delete ${props.teamName}`;
  const canDeleteTeam = () => deleteConfirmation() === deleteConfirmationPhrase();

  const teamNameValue = () => editingTeamName() ?? props.teamName;
  const hasTeamNameChanged = () => {
    const editing = editingTeamName();
    return editing !== undefined && editing.trim() !== props.teamName;
  };

  const members = createMemo(() => {
    const unsorted = teamQuery.data?.members ?? [];
    return [...unsorted].sort((a, b) => (roleOrder[a.role] ?? 3) - (roleOrder[b.role] ?? 3));
  });

  const currentMember = createMemo(() => {
    const currentUserId = userId();
    return members().find((m) => m.user_id === currentUserId);
  });

  const isOwner = createMemo(() => {
    const currentUserId = userId();
    if (!currentUserId) return false;
    return props.ownerId === currentUserId;
  });

  const handleSaveTeamName = () => {
    const newName = editingTeamName()?.trim();
    if (!props.teamId || !newName) return;

    patchTeamMutation.mutate(
      { teamId: props.teamId, request: { name: newName } },
      { onSuccess: () => setEditingTeamName(undefined) }
    );
  };

  const handleCancelTeamNameEdit = () => {
    setEditingTeamName(undefined);
  };

  const handleLeaveTeam = () => {
    const currentUserId = userId();
    if (!currentUserId || !props.teamId) return;

    removeUserMutation.mutate(
      { teamId: props.teamId, userId: currentUserId },
      { onSuccess: () => setShowLeaveModal(false) }
    );
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
    const emails = parsedEmails();
    if (emails.length === 0 || !props.teamId) return;

    inviteToTeamMutation.mutate(
      { teamId: props.teamId, request: { emails } },
      {
        onSuccess: () => {
          setInviteEmails('');
          setShowInviteModal(false);
        },
      }
    );
  };

  const handleInviteModalClose = (open: boolean) => {
    if (!open) {
      setInviteEmails('');
      setShowInviteModal(false);
    }
  };

  return (
    <>
      <header class="mb-6">
        <h2 class="text-xl font-semibold text-ink">{props.teamName}</h2>
      </header>

      <section class="mb-6">
        <header class="flex items-center justify-between mb-2">
          <div>
            <h3 class="text-sm font-medium">Details</h3>
            <p class="text-xs text-ink-muted">Team information and settings.</p>
          </div>
          <Show
            when={isOwner()}
            fallback={
              <Show when={currentMember()}>
                <Button variant="destructive" size="sm" class="rounded-xs" onClick={() => setShowLeaveModal(true)}>
                  <LeaveIcon class="size-4" />
                  Leave
                </Button>
              </Show>
            }
          >
            <Button variant="destructive" size="sm" class="rounded-xs" onClick={() => setShowDeleteTeamModal(true)}>
              <TrashIcon class="size-4" />
              Delete Team
            </Button>
          </Show>
        </header>
        <div class="border border-edge rounded-sm px-3">
          <div class="flex items-center justify-between py-2">
            <span class="text-sm font-medium text-ink-muted">Name</span>
            <Show
              when={isOwner()}
              fallback={<span class="text-sm text-ink">{props.teamName}</span>}
            >
              <div class="flex items-center gap-2">
                <input
                  type="text"
                  value={teamNameValue()}
                  onInput={(e) => setEditingTeamName(e.currentTarget.value)}
                  placeholder="Enter team name"
                  class="text-sm bg-transparent border border-edge-muted rounded-xs px-2 py-1 hover:border-edge focus:border-accent outline-none text-ink w-48"
                />
                <Show when={hasTeamNameChanged()}>
                  <div class="flex items-center gap-1 shrink-0">
                    <Tooltip tooltip="Save">
                      <Button
                        variant="accent"
                        size="icon-sm"
                        class="rounded-xs"
                        disabled={patchTeamMutation.isPending || !editingTeamName()?.trim()}
                        onClick={handleSaveTeamName}
                      >
                        <Show when={patchTeamMutation.isPending} fallback={<CheckIcon class="size-4" />}>
                          <SpinnerIcon class="size-4 animate-spin" />
                        </Show>
                      </Button>
                    </Tooltip>
                    <Tooltip tooltip="Cancel">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        class="rounded-xs"
                        disabled={patchTeamMutation.isPending}
                        onClick={handleCancelTeamNameEdit}
                      >
                        <XIcon class="size-4" />
                      </Button>
                    </Tooltip>
                  </div>
                </Show>
              </div>
            </Show>
          </div>
        </div>
      </section>

      <section class="mb-6">
        <header class="flex items-center justify-between mb-2">
          <div>
            <h3 class="text-sm font-medium">Members ({members().length})</h3>
            <p class="text-xs text-ink-muted">People who have access to this team.</p>
          </div>
          <Show when={isOwner()}>
            <Button variant="secondary" size="sm" class="rounded-xs" onClick={() => setShowInviteModal(true)}>
              <PlusIcon class="size-4" />
              Invite Member
            </Button>
          </Show>
        </header>
        <Show
          when={!teamQuery.isLoading}
          fallback={<div class="animate-pulse bg-ink-extra-muted rounded h-16" />}
        >
          <div class="border border-edge rounded-sm px-3">
            <For each={members()}>
              {(member) => (
                <MemberRow
                  member={member}
                  isOwner={isOwner()}
                  isCurrentUser={member.user_id === userId()}
                  onRemove={() => setShowRemoveModal(member)}
                  onTierChange={(newTier) => {
                    if (!props.teamId) return;
                    patchTierMutation.mutate({
                      teamId: props.teamId,
                      request: {
                        team_user_id: member.user_id,
                        new_tier: newTier,
                      },
                    });
                  }}
                />
              )}
            </For>
          </div>
        </Show>
      </section>

      <Show when={isOwner() && (invitesQuery.data?.invites?.length ?? 0) > 0}>
        <section class="mb-6">
          <h3 class="text-sm font-medium mb-2">Pending Invites</h3>
          <div class="border border-edge rounded-md px-3">
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

      <Dialog open={showLeaveModal()} onOpenChange={setShowLeaveModal}>
        <Dialog.Portal>
          <DialogWrapper>
            <div class="flex flex-col text-ink">
              <div class="shrink-0 flex flex-row items-center px-2 gap-1 border-b border-b-edge-muted h-[40px]">
                <Dialog.CloseButton as={Button} variant="ghost" size="icon-sm">
                  <XIcon />
                </Dialog.CloseButton>
                <Dialog.Title as="span" class="text-sm font-medium p-0 m-0">
                  Leave Team
                </Dialog.Title>
              </div>
              <div class="p-3 flex flex-col gap-3">
                <p>Are you sure you want to leave {props.teamName}? You will lose access to team resources.</p>
                <div class="flex justify-end gap-1 pt-2">
                  <Button
                    variant="ghost"
                    class="rounded-xs"
                    disabled={removeUserMutation.isPending}
                    onClick={() => setShowLeaveModal(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    class="rounded-xs"
                    disabled={removeUserMutation.isPending}
                    onClick={handleLeaveTeam}
                  >
                    <Show when={removeUserMutation.isPending} fallback="Leave">
                      <SpinnerIcon class="size-4 animate-spin" />
                    </Show>
                  </Button>
                </div>
              </div>
            </div>
          </DialogWrapper>
        </Dialog.Portal>
      </Dialog>

      <Dialog open={showDeleteTeamModal()} onOpenChange={handleDeleteTeamModalClose}>
        <Dialog.Portal>
          <DialogWrapper>
            <div class="flex flex-col text-ink">
              <div class="shrink-0 flex flex-row items-center px-2 gap-1 border-b border-b-edge-muted h-[40px]">
                <Dialog.CloseButton as={Button} variant="ghost" size="icon-sm">
                  <XIcon />
                </Dialog.CloseButton>
                <Dialog.Title as="span" class="text-sm font-medium p-0 m-0">
                  Delete Team
                </Dialog.Title>
              </div>
              <div class="p-3 flex flex-col gap-3">
                <p>
                  Are you sure you want to delete <span class="font-medium">{props.teamName}</span>?
                  This action cannot be undone and all team members will lose access.
                </p>
                <p class="text-sm text-ink-muted">
                  Type <span class="font-medium text-ink">{deleteConfirmationPhrase()}</span> to confirm.
                </p>
                <input
                  type="text"
                  value={deleteConfirmation()}
                  onInput={(e) => setDeleteConfirmation(e.currentTarget.value)}
                  placeholder={deleteConfirmationPhrase()}
                  class="w-full px-3 py-2 text-sm border border-edge-muted rounded-xs bg-transparent text-ink placeholder:text-ink/30 outline-none focus:border-accent/50"
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
                    variant="destructive"
                    class="rounded-xs"
                    disabled={!canDeleteTeam() || deleteTeamMutation.isPending}
                    onClick={handleDeleteTeam}
                  >
                    <Show when={deleteTeamMutation.isPending} fallback="Delete Team">
                      <SpinnerIcon class="size-4 animate-spin" />
                    </Show>
                  </Button>
                </div>
              </div>
            </div>
          </DialogWrapper>
        </Dialog.Portal>
      </Dialog>

      <Dialog open={!!showRemoveModal()} onOpenChange={() => setShowRemoveModal(null)}>
        <Dialog.Portal>
          <DialogWrapper>
            <div class="flex flex-col text-ink">
              <div class="shrink-0 flex flex-row items-center px-2 gap-1 border-b border-b-edge-muted h-[40px]">
                <Dialog.CloseButton as={Button} variant="ghost" size="icon-sm">
                  <XIcon />
                </Dialog.CloseButton>
                <Dialog.Title as="span" class="text-sm font-medium p-0 m-0">
                  Remove Member
                </Dialog.Title>
              </div>
              <div class="p-3 flex flex-col gap-3">
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
                    variant="destructive"
                    class="rounded-xs"
                    disabled={removeUserMutation.isPending}
                    onClick={handleRemoveMember}
                  >
                    <Show when={removeUserMutation.isPending} fallback="Remove">
                      <SpinnerIcon class="size-4 animate-spin" />
                    </Show>
                  </Button>
                </div>
              </div>
            </div>
          </DialogWrapper>
        </Dialog.Portal>
      </Dialog>

      <Dialog open={!!showCancelInviteModal()} onOpenChange={() => setShowCancelInviteModal(null)}>
        <Dialog.Portal>
          <DialogWrapper>
            <div class="flex flex-col text-ink">
              <div class="shrink-0 flex flex-row items-center px-2 gap-1 border-b border-b-edge-muted h-[40px]">
                <Dialog.CloseButton as={Button} variant="ghost" size="icon-sm">
                  <XIcon />
                </Dialog.CloseButton>
                <Dialog.Title as="span" class="text-sm font-medium p-0 m-0">
                  Cancel Invitation
                </Dialog.Title>
              </div>
              <div class="p-3 flex flex-col gap-3">
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
                    variant="destructive"
                    class="rounded-xs"
                    disabled={deleteInviteMutation.isPending}
                    onClick={handleCancelInvite}
                  >
                    <Show when={deleteInviteMutation.isPending} fallback="Cancel Invite">
                      <SpinnerIcon class="size-4 animate-spin" />
                    </Show>
                  </Button>
                </div>
              </div>
            </div>
          </DialogWrapper>
        </Dialog.Portal>
      </Dialog>

      <Dialog open={showInviteModal()} onOpenChange={handleInviteModalClose}>
        <Dialog.Portal>
          <DialogWrapper>
            <div class="flex flex-col text-ink">
              <div class="shrink-0 flex flex-row items-center px-2 gap-1 border-b border-b-edge-muted h-[40px]">
                <Dialog.CloseButton as={Button} variant="ghost" size="icon-sm">
                  <XIcon />
                </Dialog.CloseButton>
                <Dialog.Title as="span" class="text-sm font-medium p-0 m-0">
                  Invite to Team
                </Dialog.Title>
              </div>
              <div class="p-3 flex flex-col gap-3">
                <p class="text-sm text-ink-muted">
                  Enter email addresses separated by commas, spaces, or new lines.
                </p>
                <textarea
                  placeholder={'name@company.com\ncolleague@company.com'}
                  value={inviteEmails()}
                  onInput={(e) => setInviteEmails(e.currentTarget.value)}
                  rows={4}
                  class="w-full px-3 py-2 text-sm border border-edge-muted rounded-xs bg-input text-ink placeholder:text-ink/30 outline-none focus:border-accent/50 resize-none leading-relaxed"
                />
                <Show when={inviteEmails().trim() && parsedEmails().length > 0}>
                  <p class="text-xs text-ink-muted">
                    {parsedEmails().length} valid email{parsedEmails().length !== 1 ? 's' : ''} will be invited
                  </p>
                </Show>
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
                    variant={hasValidEmails() ? 'accent' : 'ghost'}
                    class="rounded-xs"
                    disabled={!hasValidEmails() || inviteToTeamMutation.isPending}
                    onClick={handleInvite}
                  >
                    <Show
                      when={inviteToTeamMutation.isPending}
                      fallback={parsedEmails().length > 1 ? `Send ${parsedEmails().length} Invites` : 'Send Invite'}
                    >
                      <SpinnerIcon class="size-4 animate-spin" />
                    </Show>
                  </Button>
                </div>
              </div>
            </div>
          </DialogWrapper>
        </Dialog.Portal>
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
        {(t) => <TeamManagement teamId={t.id} teamName={t.name} ownerId={t.owner_id} />}
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
    <div class="max-w-2xl mx-auto">
      <div class="p-6">
        <Suspense fallback={<div class="animate-pulse bg-ink-extra-muted rounded h-4 w-32" />}>
          <TeamContent />
        </Suspense>
      </div>
    </div>
  );
}
