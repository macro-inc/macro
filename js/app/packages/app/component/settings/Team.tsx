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
import { createMemo, createSignal, For, Show } from 'solid-js';
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
import { useRemoveUserFromTeamMutation, usePatchTeamUserTierMutation } from '@queries/team/members';
import { TeamRole } from '@service-auth/generated/schemas/teamRole';
import { TeamUserTier } from '@service-auth/generated/schemas/teamUserTier';
import type { TeamMember } from '@service-auth/generated/schemas/teamMember';
import type { TeamInviteDetails } from '@service-auth/generated/schemas/teamInviteDetails';
import { formatRelativeTimestamp } from '@entity';
import { z } from 'zod';

const roleOrder: Record<string, number> = {
  [TeamRole.Owner]: 0,
  [TeamRole.Admin]: 1,
  [TeamRole.Member]: 2,
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
          class="flex items-center justify-between gap-2 px-2 py-1.5 text-sm rounded-xs hover:bg-hover cursor-pointer outline-none data-[highlighted]:bg-hover bracket-never"
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
            when={!props.isCurrentUser && props.member.role !== TeamRole.Owner}
            fallback={
              <Tooltip tooltip={props.member.role === TeamRole.Owner ? "Cannot remove team owner" : "Cannot remove yourself"}>
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
        <div class="w-8 h-8 rounded-full border border-edge-muted flex items-center justify-center shrink-0">
          <EnvelopeIcon class="size-4 text-ink-muted" />
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

export function Team() {
  const userId = useUserId();
  const userTeamsQuery = useUserTeamsQuery();

  const team = createMemo(() => {
    const teams = userTeamsQuery.data;
    if (!teams || teams.length === 0) return null;
    return teams[0];
  });

  const teamId = createMemo(() => team()?.id ?? '');

  const teamQuery = useTeamQuery(teamId);
  const invitesQuery = useTeamInvitesQuery(teamId);

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

  const deleteConfirmationPhrase = () => `Delete ${team()?.name ?? ''}`;
  const canDeleteTeam = () => deleteConfirmation() === deleteConfirmationPhrase();

  const originalTeamName = () => team()?.name ?? '';
  const teamNameValue = () => editingTeamName() ?? originalTeamName();
  const hasTeamNameChanged = () => {
    const editing = editingTeamName();
    return editing !== undefined && editing.trim() !== originalTeamName();
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
    const teamData = team();
    if (!currentUserId || !teamData) return false;
    return teamData.owner_id === currentUserId;
  });

  const handleSaveTeamName = () => {
    const newName = editingTeamName()?.trim();
    const currentTeamId = teamId();
    if (!currentTeamId || !newName) return;

    patchTeamMutation.mutate(
      { teamId: currentTeamId, request: { name: newName } },
      { onSuccess: () => setEditingTeamName(undefined) }
    );
  };

  const handleCancelTeamNameEdit = () => {
    setEditingTeamName(undefined);
  };

  const handleLeaveTeam = () => {
    const currentUserId = userId();
    const currentTeamId = teamId();
    if (!currentUserId || !currentTeamId) return;

    removeUserMutation.mutate(
      { teamId: currentTeamId, userId: currentUserId },
      { onSuccess: () => setShowLeaveModal(false) }
    );
  };

  const handleDeleteTeam = () => {
    const currentTeamId = teamId();
    if (!currentTeamId) return;

    deleteTeamMutation.mutate(
      { teamId: currentTeamId },
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
    const currentTeamId = teamId();
    if (!currentTeamId || !member) return;

    removeUserMutation.mutate(
      { teamId: currentTeamId, userId: member.user_id },
      { onSuccess: () => setShowRemoveModal(null) }
    );
  };

  const handleCancelInvite = () => {
    const invite = showCancelInviteModal();
    const currentTeamId = teamId();
    if (!currentTeamId || !invite) return;

    deleteInviteMutation.mutate(
      { teamId: currentTeamId, teamInviteId: invite.id },
      { onSuccess: () => setShowCancelInviteModal(null) }
    );
  };

  const handleInvite = () => {
    const emails = parsedEmails();
    const currentTeamId = teamId();
    if (emails.length === 0 || !currentTeamId) return;

    inviteToTeamMutation.mutate(
      { teamId: currentTeamId, request: { emails } },
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
    <div class="max-w-2xl mx-auto">
      <div class="p-6">
        <Show
          when={!userTeamsQuery.isLoading && team()}
          fallback={
            <Show
              when={userTeamsQuery.isLoading}
              fallback={
                <div class="text-sm text-ink-muted">
                  You are not part of a team.
                </div>
              }
            >
              <div class="animate-pulse bg-ink-extra-muted rounded h-4 w-32" />
            </Show>
          }
        >
          <header class="mb-6">
            <h2 class="text-xl font-semibold text-ink">{originalTeamName()}</h2>
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
                  fallback={<span class="text-sm text-ink">{originalTeamName()}</span>}
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
                        const currentTeamId = teamId();
                        if (!currentTeamId) return;
                        patchTierMutation.mutate({
                          teamId: currentTeamId,
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
        </Show>
      </div>

      <Dialog open={showLeaveModal()} onOpenChange={setShowLeaveModal}>
        <Dialog.Portal>
          <DialogWrapper>
            <div class="flex flex-col text-ink">
              <div class="shrink-0 flex flex-row items-center px-2 gap-1 border-b-1 border-b-edge-muted h-[40px]">
                <Dialog.CloseButton as={Button} variant="ghost" size="icon-sm">
                  <XIcon />
                </Dialog.CloseButton>
                <Dialog.Title as="span" class="text-sm font-medium p-0 m-0">
                  Leave Team
                </Dialog.Title>
              </div>
              <div class="p-3 flex flex-col gap-3">
                <p>Are you sure you want to leave {team()?.name}? You will lose access to team resources.</p>
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
              <div class="shrink-0 flex flex-row items-center px-2 gap-1 border-b-1 border-b-edge-muted h-[40px]">
                <Dialog.CloseButton as={Button} variant="ghost" size="icon-sm">
                  <XIcon />
                </Dialog.CloseButton>
                <Dialog.Title as="span" class="text-sm font-medium p-0 m-0">
                  Delete Team
                </Dialog.Title>
              </div>
              <div class="p-3 flex flex-col gap-3">
                <p>
                  Are you sure you want to delete <span class="font-medium">{team()?.name}</span>?
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
              <div class="shrink-0 flex flex-row items-center px-2 gap-1 border-b-1 border-b-edge-muted h-[40px]">
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
              <div class="shrink-0 flex flex-row items-center px-2 gap-1 border-b-1 border-b-edge-muted h-[40px]">
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
              <div class="shrink-0 flex flex-row items-center px-2 gap-1 border-b-1 border-b-edge-muted h-[40px]">
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
    </div>
  );
}
