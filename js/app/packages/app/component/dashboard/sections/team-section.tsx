import { UserIcon } from '@core/component/UserIcon';
import { setInviteModalOpen } from '@app/component/app-sidebar/invite-modal';
import { useUserId } from '@core/context/user';
import { tryMacroId, useDisplayName } from '@core/user';
import UsersIcon from '@phosphor/users.svg';
import PlusIcon from '@phosphor/plus.svg';
import SearchIcon from '@phosphor/magnifying-glass.svg';
import { useUserTeamsQuery, useTeamQuery } from '@queries/team/teams';
import { TeamRole } from '@service-auth/generated/schemas/teamRole';
import type { TeamMember } from '@service-auth/generated/schemas/teamMember';
import { Button } from '@ui';
import { createMemo, createSignal, For, Show } from 'solid-js';

import {
  DashboardEmptyState,
  DashboardSection,
} from '../dashboard-section';
import { DashboardSectionLoading } from '../dashboard-section-loading';

const TEAM_MEMBERS_INITIAL = 6;
const TEAM_MEMBERS_INCREMENT = 10;

interface TeamSectionProps {
  class?: string;
}

export function TeamSection(props: TeamSectionProps) {
  const teamsQuery = useUserTeamsQuery();
  const currentTeam = createMemo(() => teamsQuery.data?.[0]);

  return (
    <Show when={currentTeam()}>
      {(team) => (
        <DashboardSection
          title={team().name}
          icon={<UsersIcon />}
          class={props.class}
          fallback={<DashboardSectionLoading rows={3} />}
        >
          <TeamContent teamId={team().id} ownerId={team().owner_id} />
        </DashboardSection>
      )}
    </Show>
  );
}

function TeamMemberRow(props: { member: TeamMember; isOwner: boolean }) {
  const [displayName] = useDisplayName(tryMacroId(props.member.user_id));

  const roleLabel = () => {
    if (props.isOwner) return 'Owner';
    return props.member.role === TeamRole.admin ? 'Admin' : 'Member';
  };

  return (
    <div class="flex items-center gap-3 py-2">
      <UserIcon id={props.member.user_id} size="sm" suppressClick />
      <div class="flex-1 min-w-0">
        <p class="text-sm text-ink truncate">{displayName()}</p>
      </div>
      <span class="text-xs text-ink-muted shrink-0">{roleLabel()}</span>
    </div>
  );
}

function TeamContent(props: { teamId: string; ownerId: string }) {
  const teamQuery = useTeamQuery(() => props.teamId);
  const userId = useUserId();
  const [search, setSearch] = createSignal('');
  const [limit, setLimit] = createSignal(TEAM_MEMBERS_INITIAL);

  const allMembers = createMemo(() => {
    const teamData = teamQuery.data;
    if (!teamData?.members) return [];
    return teamData.members;
  });

  const filteredMembers = createMemo(() => {
    const query = search().toLowerCase().trim();
    const members = allMembers();
    if (!query) return members;
    return members.filter((m) => {
      const [name] = useDisplayName(tryMacroId(m.user_id));
      return name()?.toLowerCase().includes(query);
    });
  });

  const displayedMembers = createMemo(() =>
    filteredMembers().slice(0, limit())
  );

  const hasMore = createMemo(() => filteredMembers().length > limit());

  const loadMore = () => {
    setLimit((l) => l + TEAM_MEMBERS_INCREMENT);
  };

  const isAdmin = createMemo(() => {
    const teamData = teamQuery.data;
    if (!teamData?.members) return false;
    const currentUser = teamData.members.find((m) => m.user_id === userId());
    return (
      currentUser?.role === TeamRole.admin ||
      currentUser?.role === TeamRole.owner ||
      props.ownerId === userId()
    );
  });

  return (
    <div class="flex flex-col gap-3">
      <div class="flex items-center gap-2">
        <div class="relative flex-1">
          <SearchIcon class="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-ink-muted" />
          <input
            type="text"
            value={search()}
            onInput={(e) => setSearch(e.currentTarget.value)}
            placeholder="Search team..."
            class="w-full pl-8 pr-3 py-1.5 text-sm bg-ink/5 rounded-lg border border-transparent focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none placeholder:text-ink-muted"
          />
        </div>
        <Show when={isAdmin()}>
          <Button
            variant="base"
            size="sm"
            onClick={() => setInviteModalOpen(true)}
            class="gap-1 shrink-0 h-[30px]"
          >
            <PlusIcon class="size-3.5" />
            <span>Invite</span>
          </Button>
        </Show>
      </div>
      <Show
        when={displayedMembers().length > 0}
        fallback={
          <DashboardEmptyState
            icon={<UsersIcon />}
            title={search() ? 'No matches' : 'No team members'}
            compact
          />
        }
      >
        <div class="flex flex-col gap-1 max-h-56 overflow-y-auto">
          <For each={displayedMembers()}>
            {(member) => (
              <TeamMemberRow
                member={member}
                isOwner={member.user_id === props.ownerId}
              />
            )}
          </For>
          <Show when={hasMore()}>
            <button
              type="button"
              onClick={loadMore}
              class="mx-2 py-2 text-xs text-ink-muted bg-ink/5 hover:bg-ink/10 rounded-lg transition-colors"
            >
              Load more ({filteredMembers().length - limit()} remaining)
            </button>
          </Show>
        </div>
      </Show>
    </div>
  );
}
