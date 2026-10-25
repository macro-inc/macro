import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { SearchBar } from '@app/components/view-shell/SearchBar';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { UserIcon } from '@core/component/UserIcon';
import { enableAiUsageBilling } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { getDisplayName, macroIdToEmail, tryMacroId } from '@core/user';
import { debouncedDependent } from '@core/util/debounce';
import { fuzzyFilter } from '@core/util/fuzzy';
import { getWebOrigin } from '@core/util/webOrigin';
import { formatRelativeTimestamp } from '@entity';
import type { CollectionNode } from '@kobalte/core';
import { Select } from '@kobalte/core/select';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import EnvelopeIcon from '@phosphor/envelope.svg';
import LinkIcon from '@phosphor/link.svg';
import PlusIcon from '@phosphor/plus.svg';
import TrashIcon from '@phosphor/trash.svg';
import XIcon from '@phosphor/x.svg';
import { useAiBillingSummaryQuery } from '@queries/auth';
import {
  useDeleteTeamInviteMutation,
  useTeamInvitesQuery,
} from '@queries/team/invites';
import {
  useRemoveUserFromTeamMutation,
  useSetTeamMemberPlanMutation,
} from '@queries/team/members';
import {
  usePatchTeamMutation,
  useToggleAutoJoinDomainMutation,
  useToggleNonAdminInvitesMutation,
} from '@queries/team/teams';
import type { PaidPlan } from '@service-auth/ai-billing-types';
import type { Team as TeamSummary } from '@service-auth/generated/schemas/team';
import type { TeamInviteDetails } from '@service-auth/generated/schemas/teamInviteDetails';
import type { TeamMember } from '@service-auth/generated/schemas/teamMember';
import { TeamRole } from '@service-auth/generated/schemas/teamRole';
import { Button, ConfirmDialog, ToggleSwitch, Tooltip } from '@ui';
import {
  createMemo,
  createSignal,
  For,
  mapArray,
  onCleanup,
  Show,
} from 'solid-js';
import { TeamSeatPlanSelect } from './components/team-seat-plan-select';
import {
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from './primitives';
import { InviteToTeamDialog, useTeamViewer } from './Team';
import { canInviteToTeam, canRemoveTeamMember } from './teamMemberPermissions';

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
        <Select.Content class="menu-surface z-action-menu min-w-25 p-1">
          <Select.Listbox />
        </Select.Content>
      </Select.Portal>
    </Select>
  );
}

/**
 * The plan a member's seat is billed at. Until the generated `TeamMember`
 * schema carries `plan`, read it defensively; every seat starts on Pro.
 */
function memberPlan(member: TeamMember): PaidPlan {
  const plan = (member as TeamMember & { plan?: PaidPlan }).plan;
  return plan === 'max' ? 'max' : 'premium';
}

function MemberRow(props: {
  member: TeamMember;
  isOwner: boolean;
  isCurrentUser: boolean;
  canManageRemovals: boolean;
  canRemove: boolean;
  /** Whether seat plans apply (paid team) and the viewer may change them. */
  showPlan: boolean;
  canEditPlan: boolean;
  planPending: boolean;
  pendingDowngrade: boolean;
  onRemove: () => void;
  onRoleChange: (role: TeamRole) => void;
  onPlanChange: (plan: PaidPlan) => void;
}) {
  const aiUsageBilling = useFeatureFlag(enableAiUsageBilling);
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
    <div class="flex items-center justify-between gap-2 px-4 py-4">
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
        <Show when={props.showPlan}>
          <Show
            when={props.canEditPlan}
            fallback={
              <span class="text-xs text-ink-muted capitalize">
                {memberPlan(props.member)}
              </span>
            }
          >
            <TeamSeatPlanSelect
              value={memberPlan(props.member)}
              onChange={props.onPlanChange}
              disabled={props.planPending}
              aiUsageBilling={aiUsageBilling().enabled}
              pendingDowngrade={props.pendingDowngrade}
            />
          </Show>
        </Show>
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
                  class="opacity-50 cursor-not-allowed"
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
    <div class="flex items-center justify-between gap-2 px-4 py-4">
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

/** Team › Members: the roster, roles and seats, and how people join. */
export function TeamMembers(props: { team: TeamSummary }) {
  const userId = useUserId();
  const {
    teamQuery,
    role: currentUserRole,
    isOwner,
    isAdminOrOwner,
    allowNonAdminInvites,
  } = useTeamViewer(() => props.team);
  const invitesQuery = useTeamInvitesQuery(() => props.team.id);

  const deleteInviteMutation = useDeleteTeamInviteMutation();
  const removeUserMutation = useRemoveUserFromTeamMutation();
  const patchTeamMutation = usePatchTeamMutation();
  const toggleAutoJoinMutation = useToggleAutoJoinDomainMutation();
  const toggleNonAdminInvitesMutation = useToggleNonAdminInvitesMutation();

  const [showRemoveModal, setShowRemoveModal] = createSignal<TeamMember | null>(
    null
  );
  const [showCancelInviteModal, setShowCancelInviteModal] =
    createSignal<TeamInviteDetails | null>(null);
  const [showInviteModal, setShowInviteModal] = createSignal(false);

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

  const canManageMemberRemovals = () => isAdminOrOwner();

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
    if (!props.team.id || toggleAutoJoinMutation.isPending) return;
    toggleAutoJoinMutation.mutate({ teamId: props.team.id });
  };

  const handleToggleNonAdminInvites = () => {
    if (!props.team.id || toggleNonAdminInvitesMutation.isPending) return;
    toggleNonAdminInvitesMutation.mutate({ teamId: props.team.id });
  };

  // Seat plans only exist on teams billed per seat: enterprise teams, and
  // paying teams, whose shared credits and overage are billed to the owner.
  // The team API does not expose its subscription, so a paying team is
  // recognised from the viewer's billing position: a paid tier whose payer is
  // the team owner and whose seat count spans more than one member (a free-team
  // owner with a personal subscription is billed for exactly one seat). A
  // paying team of one therefore shows no seat menu; its owner moves their own
  // seat from Billing.
  const billingSummary = useAiBillingSummaryQuery();
  const showSeatPlans = () => {
    const team = teamQuery.data?.team;
    if (!team) return false;
    if (team.enterprise) return true;
    return (
      billingSummary.isSuccess &&
      billingSummary.data.tier !== 'free' &&
      billingSummary.data.payer === team.owner_id &&
      billingSummary.data.seats > 1
    );
  };
  const setMemberPlanMutation = useSetTeamMemberPlanMutation();
  // Seat moves read and rewrite the subscription's item quantities, so only
  // one may be in flight per team: every plan menu waits while one runs.
  const planMovePending = () => setMemberPlanMutation.isPending;

  const handleRemoveMember = () => {
    const member = showRemoveModal();
    if (!props.team.id || !member) return;

    removeUserMutation.mutate(
      { teamId: props.team.id, userId: member.user_id },
      { onSuccess: () => setShowRemoveModal(null) }
    );
  };

  const handleCancelInvite = () => {
    const invite = showCancelInviteModal();
    if (!props.team.id || !invite) return;

    deleteInviteMutation.mutate(
      { teamId: props.team.id, teamInviteId: invite.id },
      { onSuccess: () => setShowCancelInviteModal(null) }
    );
  };

  return (
    <>
      <SettingsPage
        title="Members"
        description={`Invite people to ${props.team.name} and manage their roles.`}
        actions={
          // Members can invite unless the team has restricted inviting
          // to admins; removals stay admin-only.
          <Show
            when={canInviteToTeam(currentUserRole(), allowNonAdminInvites())}
          >
            {/* Inverted (black on light, white on dark) so inviting is the
                page's primary action. */}
            <Button
              variant="cta"
              glass={false}
              class="bg-ink text-[15px] text-surface"
              onClick={() => setShowInviteModal(true)}
            >
              <PlusIcon class="size-4" />
              Invite
            </Button>
          </Show>
        }
      >
        <SettingsSection>
          <Show when={showMemberSearch()}>
            <SearchBar
              size="sm"
              label="Filter members"
              placeholder="Filter members"
              value={memberQuery()}
              onValueChange={setMemberQuery}
              onEscape={() => setMemberQuery('')}
            />
          </Show>

          <Show
            when={
              teamQuery.isSuccess &&
              showSeatPlans() &&
              isAdminOrOwner() &&
              !teamQuery.data?.team.enterprise &&
              // A successful team response omits this field only on lookup failure.
              teamQuery.data?.scheduled_seat_plans == null
            }
          >
            <div
              class="flex items-center gap-2 text-xs text-ink-muted"
              role="status"
            >
              <span>Couldn't load scheduled plan changes.</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => teamQuery.refetch()}
              >
                Try again
              </Button>
            </div>
          </Show>

          <Show
            when={!teamQuery.isLoading}
            fallback={
              <SettingsCard>
                <ListSkeleton.Bar class="m-4 h-16 rounded-xl" />
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
              {/* Long rosters scroll inside the card so Invite settings
                  below stay in reach. The height cuts a row in half so the
                  list visibly continues. */}
              <SettingsCard class="max-h-[418px] overflow-y-auto! overscroll-contain">
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
                      showPlan={showSeatPlans()}
                      canEditPlan={isAdminOrOwner()}
                      planPending={planMovePending()}
                      pendingDowngrade={
                        teamQuery.data?.scheduled_seat_plans?.[member.user_id]
                          ?.plan === 'premium'
                      }
                      onPlanChange={(plan) => {
                        if (!props.team.id) return;
                        setMemberPlanMutation.mutate({
                          teamId: props.team.id,
                          userId: member.user_id,
                          plan,
                        });
                      }}
                      onRemove={() => setShowRemoveModal(member)}
                      onRoleChange={(newRole) => {
                        if (!props.team.id) return;
                        patchTeamMutation.mutate({
                          teamId: props.team.id,
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

        <Show when={isAdminOrOwner()}>
          <SettingsSection title="Invite settings">
            <SettingsCard>
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
            </SettingsCard>
          </SettingsSection>
        </Show>
      </SettingsPage>

      <ConfirmDialog
        open={!!showRemoveModal()}
        onOpenChange={(open) => !open && setShowRemoveModal(null)}
        title="Remove Member"
        tone="danger"
        confirmLabel="Remove"
        pending={removeUserMutation.isPending}
        onConfirm={handleRemoveMember}
        body={
          <>
            Are you sure you want to remove{' '}
            <Show when={showRemoveModal()}>
              {(member) => <MemberName memberId={member().user_id} />}
            </Show>{' '}
            from the team?
          </>
        }
      />
      <ConfirmDialog
        open={!!showCancelInviteModal()}
        onOpenChange={(open) => !open && setShowCancelInviteModal(null)}
        title="Cancel Invitation"
        tone="danger"
        confirmLabel="Cancel Invite"
        cancelLabel="Keep"
        pending={deleteInviteMutation.isPending}
        onConfirm={handleCancelInvite}
        body={
          <>
            Are you sure you want to cancel the invitation for{' '}
            <span class="font-medium">{showCancelInviteModal()?.email}</span>?
          </>
        }
      />

      <InviteToTeamDialog
        teamId={props.team.id}
        canManageLink={isAdminOrOwner()}
        open={showInviteModal()}
        onClose={() => setShowInviteModal(false)}
      />
    </>
  );
}
