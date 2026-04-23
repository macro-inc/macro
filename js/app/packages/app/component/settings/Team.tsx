import { UserIcon } from '@core/component/UserIcon';
import LeaveIcon from '@icon/regular/sign-out.svg';
import PlusIcon from '@icon/regular/plus.svg';
import TrashIcon from '@icon/regular/trash.svg';
import XIcon from '@icon/regular/x.svg';
import CaretDownIcon from '@icon/regular/caret-down.svg';
import CheckIcon from '@icon/regular/check.svg';
import EditableField from '@core/component/EditableField';
import { Modal, Overlay, Content, Header, Message, ButtonBar } from '@core/component/Modal';
import { Tooltip } from '@core/component/Tooltip';
import { Button } from '@ui/components/Button';
import { Select } from '@kobalte/core/select';
import { useUserId } from '@core/context/user';
import { useDisplayName, tryMacroId } from '@core/user';
import { createMemo, createSignal, For, Show } from 'solid-js';
import type { CollectionNode } from '@kobalte/core';
import {
  useUserTeamsQuery,
  useTeamQuery,
  usePatchTeamMutation,
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
          class="flex items-center justify-between gap-2 px-2 py-1.5 text-xs rounded-xs hover:bg-hover cursor-pointer outline-none data-[highlighted]:bg-hover"
        >
          <Select.ItemLabel>{itemProps.item.rawValue.label}</Select.ItemLabel>
          <Select.ItemIndicator>
            <CheckIcon class="w-3 h-3" />
          </Select.ItemIndicator>
        </Select.Item>
      )}
    >
      <Select.Trigger as={Button} size="sm" class="rounded-xs">
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

function MemberRow(props: {
  member: TeamMember;
  canManage: boolean;
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
          <div class="text-sm text-ink truncate">
            {displayName()}
            {props.isCurrentUser && <span class="text-ink-muted"> (you)</span>}
          </div>
          <div class="text-xs text-ink-muted">{props.member.role}</div>
        </div>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <Show
          when={props.canManage}
          fallback={<span class="text-xs text-ink-muted">{props.member.tier}</span>}
        >
          <TierSelect value={props.member.tier} onChange={props.onTierChange} />
        </Show>
        <Show when={props.canManage}>
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

function InviteRow(props: {
  invite: TeamInviteDetails;
  canManage: boolean;
  onCancel: () => void;
}) {
  return (
    <div class="flex items-center justify-between py-2 border-b border-edge-muted last:border-b-0">
      <div class="flex items-center gap-3 min-w-0 flex-1">
        <div class="w-8 h-8 rounded-full bg-ink-extra-muted flex items-center justify-center shrink-0">
          <span class="text-xs text-ink-muted">?</span>
        </div>
        <div class="min-w-0 flex-1">
          <div class="text-sm text-ink truncate">{props.invite.email}</div>
          <div class="text-xs text-ink-muted">Pending invite</div>
        </div>
      </div>
      <Show when={props.canManage}>
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

  const [showLeaveModal, setShowLeaveModal] = createSignal(false);
  const [showRemoveModal, setShowRemoveModal] = createSignal<string | null>(null);
  const [showCancelInviteModal, setShowCancelInviteModal] = createSignal<string | null>(null);
  const [showInviteModal, setShowInviteModal] = createSignal(false);
  const [inviteEmail, setInviteEmail] = createSignal('');
  const [updatedTeamName, setUpdatedTeamName] = createSignal<string | undefined>(undefined);

  const teamName = () => updatedTeamName() ?? team()?.name ?? '';

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

  const canManage = createMemo(() => {
    const role = currentMember()?.role;
    return role === TeamRole.Owner || role === TeamRole.Admin;
  });

  const handleLeaveTeam = async () => {
    const currentUserId = userId();
    const currentTeamId = teamId();
    if (!currentUserId || !currentTeamId) return;

    removeUserMutation.mutate({
      teamId: currentTeamId,
      userId: currentUserId,
    });
    setShowLeaveModal(false);
  };

  const handleRemoveMember = (memberId: string) => {
    const currentTeamId = teamId();
    if (!currentTeamId) return;

    removeUserMutation.mutate({
      teamId: currentTeamId,
      userId: memberId,
    });
    setShowRemoveModal(null);
  };

  const handleCancelInvite = (inviteId: string) => {
    const currentTeamId = teamId();
    if (!currentTeamId) return;

    deleteInviteMutation.mutate({
      teamId: currentTeamId,
      teamInviteId: inviteId,
    });
    setShowCancelInviteModal(null);
  };

  const handleInvite = () => {
    const email = inviteEmail().trim();
    const currentTeamId = teamId();
    if (!email || !currentTeamId) return;

    inviteToTeamMutation.mutate({
      teamId: currentTeamId,
      request: { emails: [email] },
    });
    setInviteEmail('');
    setShowInviteModal(false);
  };

  return (
    <div class="absolute inset-0 overflow-y-auto" style="scrollbar-width: none;">
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
          <header class="flex items-start justify-between gap-4 mb-8">
            <section class="min-w-0 flex-1">
              <h2 class="text-sm">Team</h2>
              <Show
                when={isOwner()}
                fallback={<div class="text-ink text-xl font-semibold truncate">{teamName()}</div>}
              >
                <EditableField
                  class="text-xl font-semibold"
                  value={teamName()}
                  onSave={(newValue: string) => {
                    const currentTeamId = teamId();
                    if (!currentTeamId || !newValue.trim()) return;
                    setUpdatedTeamName(newValue);
                    patchTeamMutation.mutate({
                      teamId: currentTeamId,
                      request: { name: newValue },
                    });
                  }}
                  placeholder="Enter team name"
                  allowEmpty={false}
                />
              </Show>
            </section>
            <Show when={currentMember() && currentMember()?.role !== TeamRole.Owner}>
              <Button variant="destructive" size="sm" class="rounded-xs" onClick={() => setShowLeaveModal(true)}>
                <LeaveIcon class="w-4 h-4" />
                Leave
              </Button>
            </Show>
          </header>

          <section class="mb-6">
            <div class="flex items-center justify-between mb-1">
              <h3 class="text-sm">Members</h3>
              <Show when={canManage()}>
                <Button variant="secondary" size="sm" class="rounded-xs" onClick={() => setShowInviteModal(true)}>
                  <PlusIcon class="w-4 h-4" />
                  Invite
                </Button>
              </Show>
            </div>
            <p class="text-xs text-ink-muted mb-2">People who have access to this team.</p>
            <Show
              when={!teamQuery.isLoading}
              fallback={<div class="animate-pulse bg-ink-extra-muted rounded h-16" />}
            >
              <div class="border border-edge rounded-md px-3">
                <For each={members()}>
                  {(member) => (
                    <MemberRow
                      member={member}
                      canManage={canManage()}
                      isCurrentUser={member.user_id === userId()}
                      onRemove={() => setShowRemoveModal(member.user_id)}
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

          <Show when={canManage() && (invitesQuery.data?.invites?.length ?? 0) > 0}>
            <section class="mb-6">
              <h3 class="text-sm mb-2">Pending Invites</h3>
              <div class="border border-edge rounded-md px-3">
                <For each={invitesQuery.data?.invites ?? []}>
                  {(invite) => (
                    <InviteRow
                      invite={invite}
                      canManage={canManage()}
                      onCancel={() => setShowCancelInviteModal(invite.id)}
                    />
                  )}
                </For>
              </div>
            </section>
          </Show>
        </Show>
      </div>

      <Modal open={showLeaveModal()} onOpenChange={setShowLeaveModal}>
        <Overlay />
        <Content>
          <Header>Leave Team</Header>
          <Message>
            Are you sure you want to leave {team()?.name}? You will lose access to team resources.
          </Message>
          <ButtonBar>
            <Button variant="secondary" onClick={() => setShowLeaveModal(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleLeaveTeam}>
              Leave
            </Button>
          </ButtonBar>
        </Content>
      </Modal>

      <Modal open={!!showRemoveModal()} onOpenChange={() => setShowRemoveModal(null)}>
        <Overlay />
        <Content>
          <Header>Remove Member</Header>
          <Message>
            Are you sure you want to remove this member from the team?
          </Message>
          <ButtonBar>
            <Button variant="secondary" onClick={() => setShowRemoveModal(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const memberId = showRemoveModal();
                if (memberId) handleRemoveMember(memberId);
              }}
            >
              Remove
            </Button>
          </ButtonBar>
        </Content>
      </Modal>

      <Modal open={!!showCancelInviteModal()} onOpenChange={() => setShowCancelInviteModal(null)}>
        <Overlay />
        <Content>
          <Header>Cancel Invitation</Header>
          <Message>
            Are you sure you want to cancel this invitation?
          </Message>
          <ButtonBar>
            <Button variant="secondary" onClick={() => setShowCancelInviteModal(null)}>
              Keep
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const inviteId = showCancelInviteModal();
                if (inviteId) handleCancelInvite(inviteId);
              }}
            >
              Cancel Invite
            </Button>
          </ButtonBar>
        </Content>
      </Modal>

      <Modal open={showInviteModal()} onOpenChange={setShowInviteModal}>
        <Overlay />
        <Content>
          <Header>Invite to Team</Header>
          <Message>
            <input
              type="email"
              placeholder="Email address"
              value={inviteEmail()}
              onInput={(e) => setInviteEmail(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleInvite();
              }}
              class="w-full px-3 py-2 border border-edge rounded-md bg-panel text-ink text-sm"
            />
          </Message>
          <ButtonBar>
            <Button variant="secondary" onClick={() => setShowInviteModal(false)}>
              Cancel
            </Button>
            <Button variant="accent" onClick={handleInvite}>
              Send Invite
            </Button>
          </ButtonBar>
        </Content>
      </Modal>
    </div>
  );
}
