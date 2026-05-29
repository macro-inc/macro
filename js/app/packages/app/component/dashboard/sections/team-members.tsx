import { CustomScrollbar } from '@core/component/CustomScrollbar';
import { useSettingsState } from '@core/constant/SettingsState';
import { useUserId } from '@core/context/user';
import { macroIdToEmail, tryMacroId, useDisplayName } from '@core/user';
import { UserIcon } from '@core/component/UserIcon';
import PlusIcon from '@phosphor/plus.svg';
import UsersThreeIcon from '@phosphor/users-three.svg';
import { useTeamQuery, useUserTeamsQuery } from '@queries/team';
import { TeamRole } from '@service-auth/generated/schemas/teamRole';
import type { TeamMember } from '@service-auth/generated/schemas/teamMember';
import { Button, Layer } from '@ui';
import { createMemo, createSignal, For, Show } from 'solid-js';

const roleOrder: Record<string, number> = {
  [TeamRole.owner]: 0,
  [TeamRole.admin]: 1,
  [TeamRole.member]: 2,
};

function MemberRow(props: { member: TeamMember; isCurrentUser: boolean }) {
  const macroId = () => tryMacroId(props.member.user_id);
  const [displayName] = useDisplayName(macroId());
  const email = () => {
    const id = macroId();
    return id ? macroIdToEmail(id) : undefined;
  };
  const label = () => displayName() || email() || props.member.user_id;

  return (
    <div class="group relative flex w-full items-center gap-3 rounded-lg p-2.5 transition hover:bg-active/60 hover:ring hover:ring-edge hover:ring-inset focus:outline-none focus-visible:bg-active/60 focus-visible:ring focus-visible:ring-edge focus-visible:ring-inset">
      <UserIcon
        id={props.member.user_id}
        size="md"
        suppressClick
        showTooltip={false}
      />
      <div class="min-w-0 flex-1">
        <div class="truncate text-sm font-medium text-ink">
          {label()}
          <Show when={props.isCurrentUser}>
            <span class="font-normal text-ink-muted"> (you)</span>
          </Show>
        </div>
        <Show when={email() && email() !== label()}>
          <div class="select-text truncate text-xs text-ink-muted">
            {email()}
          </div>
        </Show>
      </div>
      <span class="shrink-0 rounded-md bg-hover px-1.5 py-1 text-xxs font-semibold capitalize text-ink-muted">
        {props.member.role}
      </span>
    </div>
  );
}

export function TeamMembersSection() {
  const userTeamsQuery = useUserTeamsQuery();
  const userId = useUserId();
  const { openSettings } = useSettingsState();
  const [scrollContainer, setScrollContainer] = createSignal<HTMLElement>();

  const firstTeam = createMemo(() => userTeamsQuery.data?.[0]);
  const teamQuery = useTeamQuery(() => firstTeam()?.id ?? '');

  const members = createMemo(() => {
    const unsorted = teamQuery.data?.members ?? [];
    return [...unsorted].sort((a, b) => {
      const roleCompare = (roleOrder[a.role] ?? 3) - (roleOrder[b.role] ?? 3);
      if (roleCompare !== 0) return roleCompare;
      return a.user_id.localeCompare(b.user_id);
    });
  });

  const currentMember = createMemo(() =>
    members().find((member) => member.user_id === userId())
  );
  const isOwner = createMemo(() => currentMember()?.role === TeamRole.owner);

  return (
    <section>
      <Layer depth={2}>
        <div class="overflow-hidden rounded-2xl border border-edge-muted bg-surface">
          <div class="flex items-start justify-between gap-3 p-3">
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <h2 class="truncate text-lg font-semibold tracking-tight text-ink">
                  {firstTeam()?.name ?? 'Team'}
                </h2>
              </div>
              <Show when={firstTeam()}>
                {(team) => (
                  <div class="mt-1 min-w-0">
                    <p class="truncate text-xxs text-ink-muted">
                      @{team().slug}
                    </p>
                  </div>
                )}
              </Show>
            </div>
            <Show when={firstTeam() && isOwner()}>
              <Button
                variant="base"
                size="sm"
                depth={3}
                class="h-8 shrink-0 rounded-lg bg-surface px-3"
                onClick={() => openSettings('Team')}
              >
                Manage
              </Button>
            </Show>
          </div>

          <Show
            when={!userTeamsQuery.isLoading && !teamQuery.isLoading}
            fallback={
              <div class="space-y-1 px-3 pb-3">
                <For each={[0, 1, 2]}>
                  {() => (
                    <div class="flex h-12 items-center gap-3 rounded-lg p-2.5">
                      <div class="size-7 rounded-full bg-hover" />
                      <div class="min-w-0 flex-1 space-y-2">
                        <div class="h-2.5 w-3/5 rounded-full bg-ink/10" />
                        <div class="h-2 w-2/5 rounded-full bg-ink/5" />
                      </div>
                    </div>
                  )}
                </For>
              </div>
            }
          >
            <Show
              when={firstTeam()}
              fallback={
                <div class="px-3 pb-3">
                  <div class="flex flex-col items-center justify-center rounded-xl bg-hover/50 px-4 py-6 text-center">
                    <UsersThreeIcon class="mb-3 size-6 text-ink-muted" />
                    <p class="text-sm font-medium text-ink">No team yet</p>
                    <p class="mt-1 text-xs text-ink-muted">
                      Create a team to collaborate with others.
                    </p>
                    <Button
                      variant="base"
                      size="sm"
                      depth={3}
                      class="mt-4 rounded-lg bg-surface"
                      onClick={() => openSettings('Team')}
                    >
                      <PlusIcon class="size-3.5" />
                      Create team
                    </Button>
                  </div>
                </div>
              }
            >
              <div class="px-3 pb-3">
                <div class="relative">
                  <div
                    ref={setScrollContainer}
                    class="max-h-64 overflow-y-auto"
                  >
                    <div class="space-y-1 pb-1">
                      <For each={members()}>
                        {(member) => (
                          <MemberRow
                            member={member}
                            isCurrentUser={member.user_id === userId()}
                          />
                        )}
                      </For>
                    </div>
                  </div>
                  <CustomScrollbar
                    scrollContainer={scrollContainer}
                    labelVisibilityDebounceMs={Infinity}
                    class="right-0.5"
                  />
                </div>
              </div>
            </Show>
          </Show>
        </div>
      </Layer>
    </section>
  );
}
