import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { SearchBar } from '@app/components/view-shell/SearchBar';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import {
  ENABLE_AGENT_FACES,
  enableCrmMemberAccessChanges,
  enableSelfHostedTeammates,
} from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import {
  getDisplayName,
  isAgentAccount,
  macroIdToEmail,
  tryMacroId,
} from '@core/user';
import { debouncedDependent } from '@core/util/debounce';
import { fireAndForget } from '@core/util/fireAndForget';
import { fuzzyFilter } from '@core/util/fuzzy';
import PlusIcon from '@icon/system/regular/plus.svg';
import { useAiBillingSummaryQuery } from '@queries/auth';
import { useComputersQuery } from '@queries/computers/computers';
import {
  useDeleteTeamInviteMutation,
  useResendTeamInviteMutation,
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
import { useTeammateHostsQuery } from '@queries/team-agents/hosts';
import { useRemoveTeamAgentMutation } from '@queries/team-agents/team-agents';
import type { PaidPlan } from '@service-auth/ai-billing-types';
import type { Team as TeamSummary } from '@service-auth/generated/schemas/team';
import type { TeamInviteDetails } from '@service-auth/generated/schemas/teamInviteDetails';
import type { TeamMember } from '@service-auth/generated/schemas/teamMember';
import { TeamRole } from '@service-auth/generated/schemas/teamRole';
import type { TeamAgent } from '@service-auth/team-agents';
import { Key } from '@solid-primitives/keyed';
import { Button, ConfirmDialog, ToggleSwitch } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  mapArray,
  Show,
} from 'solid-js';
import {
  AgentPictureDialog,
  type AgentPictureSelection,
} from './components/agent-picture-dialog';
import { AgentVoiceDialog } from './components/agent-voice-dialog';
import { MoveTeammateDialog } from './components/move-teammate-dialog';
import { TeamAgentRow } from './components/team-agent-row';
import { TeamInviteRow } from './components/team-invite-row';
import { TeamMemberRow } from './components/team-member-row';
import { TeammateCommand } from './components/teammate-command';
import { TeammateRunsOn } from './components/teammate-runs-on';
import { teamAgentComputer, teamAgentSetupStep } from './core/team-agent-setup';
import {
  canMoveTeammate,
  ownMachineRemoveBody,
  teammatePlacement,
} from './core/teammate-host';
import { installProblemLine } from './core/teammate-install-problem';
import {
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from './primitives';
import { useRetryTeamAgentSetup } from './primitives/team-agent-status';
import {
  hasCrmAccess,
  memberEmail,
  memberName,
  sortTeamMembers,
  useTeamAgents,
} from './primitives/team-roster';
import {
  type InviteKind,
  InviteToTeamDialog,
  useCanInviteAgents,
  useTeamViewer,
} from './Team';
import { CopyTeamInviteLinkButton } from './TeamInviteLinkSection';
import {
  canInviteToTeam,
  canRemoveTeamMember,
  isTeamAdminOrOwner,
} from './teamMemberPermissions';
import {
  TeamAgentMenu as MobileTeamAgentMenu,
  TeamMemberMenu as MobileTeamMemberMenu,
} from './views/mobile/team-member-menu';
import {
  type RemovalLock,
  type RoleLock,
  roleName,
  seatPlanName,
  type TeamAgentMenuProps,
  type TeamMemberMenuProps,
} from './views/shared/team-member-menu';
import { TeamAgentClaude } from './views/team-agent-claude';
import { TeamAgentMenu, TeamMemberMenu } from './views/team-member-menu';

/**
 * The plan a member's seat is billed at. Until the generated `TeamMember`
 * schema carries `plan`, read it defensively; every seat starts on Pro.
 */
function memberPlan(member: TeamMember): PaidPlan {
  const plan = (member as TeamMember & { plan?: PaidPlan }).plan;
  return plan === 'max' ? 'max' : 'premium';
}

/** A person's ⋯: a menu on desktop, a sheet on touch, as Machines does. */
function MemberMenu(props: TeamMemberMenuProps) {
  return (
    <Show when={isTouchDevice()} fallback={<TeamMemberMenu {...props} />}>
      <MobileTeamMemberMenu {...props} />
    </Show>
  );
}

function AgentMenu(props: TeamAgentMenuProps) {
  return (
    <Show when={isTouchDevice()} fallback={<TeamAgentMenu {...props} />}>
      <MobileTeamAgentMenu {...props} />
    </Show>
  );
}

function MemberName(props: { memberId: string }) {
  const displayName = () => getDisplayName(tryMacroId(props.memberId));
  return <span class="font-medium">{displayName()}</span>;
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
  const resendInviteMutation = useResendTeamInviteMutation();
  const removeUserMutation = useRemoveUserFromTeamMutation();
  const patchTeamMutation = usePatchTeamMutation();
  const crmAccessMutation = usePatchTeamMutation();
  const crmAccessChanges = useFeatureFlag(enableCrmMemberAccessChanges);
  const canManageCrm = () => isAdminOrOwner() && crmAccessChanges().enabled;
  const toggleAutoJoinMutation = useToggleAutoJoinDomainMutation();
  const toggleNonAdminInvitesMutation = useToggleNonAdminInvitesMutation();

  const [showRemoveModal, setShowRemoveModal] = createSignal<TeamMember | null>(
    null
  );
  const [showCancelInviteModal, setShowCancelInviteModal] =
    createSignal<TeamInviteDetails | null>(null);
  // The invite flow open, if any: people by email, or an agent teammate.
  const [showInviteModal, setShowInviteModal] = createSignal<InviteKind>();
  const [agentToRemove, setAgentToRemove] = createSignal<TeamAgent | null>(
    null
  );

  // Agent teammates: listed with their status once the flag is on. Loading
  // is not on, and off leaves the roster exactly as it was.
  const canInviteAgents = useCanInviteAgents(isAdminOrOwner);
  const { enabled: agentsOn, agents } = useTeamAgents(() => props.team.id);
  const removeAgentMutation = useRemoveTeamAgentMutation();
  const agentUserIds = () => agents().map((agent) => agent.userId);
  // The step a new agent's computer is on, read while one is being set up
  // or has failed; any member can read the team's computers.
  const computersQuery = useComputersQuery(() =>
    agents().some(
      (agent) => agent.status === 'provisioning' || agent.status === 'failed'
    )
  );
  const agentSetupStep = (agent: TeamAgent) =>
    agent.status === 'provisioning'
      ? teamAgentSetupStep(
          teamAgentComputer(
            agent,
            computersQuery.isSuccess ? computersQuery.data : undefined
          )
        )
      : undefined;
  const retryAgent = useRetryTeamAgentSetup();
  // Voices are team-admin only on the server, like the rest of agent management.
  const canChangeVoice = () => agentsOn() && isAdminOrOwner();
  // Pictures, too.
  const canChangePicture = () => ENABLE_AGENT_FACES && canChangeVoice();
  // Agents on an admin's own machine: which machine, and moving them.
  const selfHostedFlag = useFeatureFlag(enableSelfHostedTeammates);
  const selfHosted = () =>
    agentsOn() && !selfHostedFlag().loading && selfHostedFlag().enabled;
  const hostsQuery = useTeammateHostsQuery(
    () => props.team.id,
    () => selfHosted() && agents().some((agent) => !!agent.harnessId)
  );
  /** The name of the machine an agent runs on, if it runs on one of ours. */
  const machineName = (harnessId: string) => {
    const hosts = hostsQuery.isSuccess ? hostsQuery.data.hosts : [];
    return (
      hosts.find((host) => host.harnessId === harnessId)?.name ??
      t('teamAgents.ownersComputer')
    );
  };
  const hostName = (agent: TeamAgent) =>
    agent.harnessId ? machineName(agent.harnessId) : undefined;
  /** The viewer's own machines: who may move an agent depends on them. */
  const ownHarnessIds = () =>
    hostsQuery.isSuccess
      ? hostsQuery.data.hosts.map((host) => host.harnessId)
      : [];
  /**
   * The machine it runs on; nothing while it is parked off one or moving
   * (the old machine is only saving its memory).
   */
  const hostedName = (agent: TeamAgent) => {
    const placement = teammatePlacement(agent);
    return placement.kind === 'on'
      ? machineName(placement.harnessId)
      : undefined;
  };
  /** The machine a moving agent is moving to. */
  const movingToName = (agent: TeamAgent) => {
    const placement = teammatePlacement(agent);
    return placement.kind === 'movingTo'
      ? machineName(placement.harnessId)
      : undefined;
  };
  const [moveAgent, setMoveAgent] = createSignal<TeamAgent>();
  const [voiceAgent, setVoiceAgent] = createSignal<TeamAgent>();
  const [pictureAgent, setPictureAgent] = createSignal<AgentPictureSelection>();
  // Losing access closes the dialogs for good, not until access returns.
  createEffect(() => {
    if (canChangeVoice()) return;
    setVoiceAgent(undefined);
    setPictureAgent(undefined);
    setMoveAgent(undefined);
  });

  const members = createMemo(() =>
    sortTeamMembers(teamQuery.data?.members ?? [])
  );

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

  // Agents are team members too; they get their own rows, with status.
  const filteredPeople = () =>
    filteredMembers().filter(
      (member) => !agentUserIds().includes(member.user_id)
    );
  const filteredAgents = createMemo(() => {
    const q = debouncedMemberQuery().trim().toLowerCase();
    if (!q) return agents();
    return fuzzyFilter(q, agents(), (agent) =>
      `${agent.name} ${agent.jobDescription}`.toLowerCase()
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

  const crmAccessOf = (member: TeamMember) =>
    hasCrmAccess(member, teamQuery.data?.crm_member_access);
  const pendingDowngradeOf = (member: TeamMember) =>
    teamQuery.data?.scheduled_seat_plans?.[member.user_id]?.plan === 'premium';

  // One muted line under the name: role, seat plan, and only what differs
  // from the usual (a Max seat dropping to Pro, CRM access turned off).
  const memberSummary = (member: TeamMember) => {
    const plan = memberPlan(member);
    return [
      roleName(member.role),
      showSeatPlans() && seatPlanName(plan),
      isAdminOrOwner() &&
        plan === 'max' &&
        pendingDowngradeOf(member) &&
        t('teamMembers.proAtRenewal'),
      canManageCrm() && !crmAccessOf(member) && t('crm.memberAccessOff'),
    ]
      .filter(Boolean)
      .join(' · ');
  };

  const roleLockOf = (member: TeamMember): RoleLock | undefined => {
    if (member.role === TeamRole.owner) return 'owner';
    return isOwner() ? undefined : 'not-owner';
  };
  const removalLockOf = (member: TeamMember): RemovalLock | undefined => {
    if (canRemoveTeamMember(userId(), currentUserRole(), member)) return;
    return member.role === TeamRole.owner ? 'owner' : 'self';
  };

  const handleRemoveMember = () => {
    const member = showRemoveModal();
    if (!props.team.id || !member) return;

    removeUserMutation.mutate(
      { teamId: props.team.id, userId: member.user_id },
      { onSuccess: () => setShowRemoveModal(null) }
    );
  };

  const handleRemoveAgent = () => {
    const agent = agentToRemove();
    if (!props.team.id || !agent) return;

    removeAgentMutation.mutate(
      { teamId: props.team.id, userId: agent.userId },
      {
        onSuccess: () => setAgentToRemove(null),
        onError: () =>
          toast.failure(t('teamAgents.removeFailed', { name: agent.name })),
      }
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
            {/* A narrow page wraps the invite buttons, as a pair, onto
                their own line. */}
            <div class="flex flex-wrap items-center gap-2">
              {/* A link someone sends themselves gets opened; keep it one
                  click from the page alongside the email invite. */}
              <CopyTeamInviteLinkButton
                teamId={props.team.id}
                class="text-[15px]"
              />
              {/* One button per kind of invite, each opening its flow. */}
              <div class="flex items-center gap-2">
                <Button
                  variant="secondary"
                  class="text-[15px]"
                  onClick={() => setShowInviteModal('people')}
                >
                  <PlusIcon class="size-4" />
                  Invite Human
                </Button>
                <Show when={canInviteAgents()}>
                  <Button
                    variant="secondary"
                    class="text-[15px]"
                    onClick={() => setShowInviteModal('agent')}
                  >
                    <PlusIcon class="size-4" />
                    Invite Agent
                  </Button>
                </Show>
              </div>
            </div>
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
              when={filteredPeople().length + filteredAgents().length > 0}
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
                {/* Keyed by person, so a refetch keeps each row and a ⋯ open
                    on it. */}
                <Key each={filteredPeople()} by="user_id">
                  {(member) => (
                    <TeamMemberRow
                      userId={member().user_id}
                      name={memberName(member())}
                      email={memberEmail(member())}
                      isCurrentUser={member().user_id === userId()}
                      isAgent={isAgentAccount(tryMacroId(member().user_id))}
                      summary={memberSummary(member())}
                      menu={
                        <Show when={canManageMemberRemovals()}>
                          <MemberMenu
                            name={memberName(member())}
                            email={memberEmail(member())}
                            plan={
                              showSeatPlans() ? memberPlan(member()) : undefined
                            }
                            pendingDowngrade={pendingDowngradeOf(member())}
                            planPending={planMovePending()}
                            onPlanChange={(plan) => {
                              if (!props.team.id) return;
                              setMemberPlanMutation.mutate({
                                teamId: props.team.id,
                                userId: member().user_id,
                                plan,
                              });
                            }}
                            role={member().role}
                            roleLock={roleLockOf(member())}
                            onRoleChange={(role) => {
                              if (!props.team.id) return;
                              patchTeamMutation.mutate({
                                teamId: props.team.id,
                                request: {
                                  user_role_updates: [
                                    { team_user_id: member().user_id, role },
                                  ],
                                },
                              });
                            }}
                            manageCrm={canManageCrm()}
                            crmAccess={crmAccessOf(member())}
                            crmPending={crmAccessMutation.isPending}
                            onCrmAccessChange={(enabled) => {
                              crmAccessMutation.mutate({
                                teamId: props.team.id,
                                request: {
                                  member_crm_access: {
                                    user_id: member().user_id,
                                    enabled,
                                  },
                                },
                              });
                            }}
                            removalLock={removalLockOf(member())}
                            onRemove={() => setShowRemoveModal(member())}
                          />
                        </Show>
                      }
                    />
                  )}
                </Key>
                <For each={filteredAgents()}>
                  {(agent) => (
                    <TeamAgentRow
                      agent={agent}
                      menu={
                        <AgentMenu
                          name={agent.name}
                          onChangePicture={
                            canChangePicture()
                              ? (opener) => setPictureAgent({ agent, opener })
                              : undefined
                          }
                          onChangeVoice={
                            canChangeVoice()
                              ? () => setVoiceAgent(agent)
                              : undefined
                          }
                          onMove={
                            selfHosted() &&
                            isAdminOrOwner() &&
                            canMoveTeammate(agent, userId(), ownHarnessIds(), {
                              ownsTeam: isOwner(),
                            })
                              ? () => setMoveAgent(agent)
                              : undefined
                          }
                          onRemove={
                            isAdminOrOwner()
                              ? () => setAgentToRemove(agent)
                              : undefined
                          }
                        />
                      }
                      problem={
                        selfHosted()
                          ? installProblemLine(
                              agent.installProblem,
                              hostName(agent) ?? t('teamAgents.ownersComputer')
                            )
                          : undefined
                      }
                      problemTone={
                        agent.installProblem?.kind === 'hostRemoved'
                          ? 'muted'
                          : 'failure'
                      }
                      setupStep={agentSetupStep(agent)}
                      onRetry={
                        isAdminOrOwner() &&
                        agent.status === 'failed' &&
                        agent.computerId
                          ? () =>
                              fireAndForget(
                                retryAgent.run(agent),
                                'team-agent.retry'
                              )
                          : undefined
                      }
                      retrying={retryAgent.pending()}
                      statusLabel={
                        selfHosted() && movingToName(agent)
                          ? t('teammateHosts.movingTo', {
                              host: movingToName(agent),
                            })
                          : undefined
                      }
                      runsOn={
                        <Show when={selfHosted() && hostedName(agent)}>
                          {(host) => <TeammateRunsOn host={host()} />}
                        </Show>
                      }
                      claude={
                        <Show when={isAdminOrOwner() && !movingToName(agent)}>
                          <Show
                            when={selfHosted() && hostedName(agent)}
                            fallback={<TeamAgentClaude agent={agent} />}
                          >
                            {(host) => (
                              <div class="flex flex-wrap items-center gap-x-1 text-xs text-ink-muted">
                                {t('teammateHosts.ownClaudeHint', {
                                  host: host(),
                                })}
                                <TeammateCommand command="macrod teammate sign-in" />
                              </div>
                            )}
                          </Show>
                        </Show>
                      }
                    />
                  )}
                </For>
              </SettingsCard>
            </Show>
          </Show>
          <Show when={canManageCrm()}>
            <p class="text-xs text-ink-muted">{t('crm.memberAccessAlways')}</p>
          </Show>
        </SettingsSection>

        <Show
          when={
            // Listing and cancelling invites are admin-only on the server.
            isTeamAdminOrOwner(currentUserRole()) &&
            (invitesQuery.data?.invites?.length ?? 0) > 0
          }
        >
          <SettingsSection title="Pending invites">
            <SettingsCard>
              <For each={invitesQuery.data?.invites ?? []}>
                {(invite) => (
                  <TeamInviteRow
                    invite={invite}
                    canChange={isTeamAdminOrOwner(currentUserRole())}
                    resending={
                      resendInviteMutation.isPending &&
                      resendInviteMutation.variables?.email === invite.email
                    }
                    onResend={() =>
                      resendInviteMutation.mutate({
                        teamId: props.team.id,
                        email: invite.email,
                      })
                    }
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
        open={!!agentToRemove()}
        onOpenChange={(open) => !open && setAgentToRemove(null)}
        title={t('teamAgents.removeTitle', {
          name: agentToRemove()?.name ?? '',
        })}
        tone="danger"
        confirmLabel={t('teamAgents.removeConfirm')}
        pending={removeAgentMutation.isPending}
        onConfirm={handleRemoveAgent}
        body={(() => {
          const agent = agentToRemove();
          const host = agent && selfHosted() ? hostName(agent) : undefined;
          return host ? ownMachineRemoveBody(host) : t('teamAgents.removeBody');
        })()}
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

      <AgentPictureDialog
        selection={canChangePicture() ? pictureAgent() : undefined}
        onClose={() => setPictureAgent(undefined)}
      />
      <MoveTeammateDialog
        teamId={props.team.id}
        agent={selfHosted() && isAdminOrOwner() ? moveAgent() : undefined}
        onClose={() => setMoveAgent(undefined)}
      />
      <AgentVoiceDialog
        teamId={props.team.id}
        agent={canChangeVoice() ? voiceAgent() : undefined}
        onClose={() => setVoiceAgent(undefined)}
      />
      <InviteToTeamDialog
        teamId={props.team.id}
        canManageLink={isAdminOrOwner()}
        kind={showInviteModal()}
        canInviteAgents={canInviteAgents()}
        open={!!showInviteModal()}
        onClose={() => setShowInviteModal(undefined)}
      />
    </>
  );
}
