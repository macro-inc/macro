import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { t } from '@app/lib/i18n';
import { useUserId } from '@core/context/user';
import PlusIcon from '@icon/system/regular/plus.svg';
import { queryReadyGate } from '@queries/gate';
import { useSubteamsQuery } from '@queries/team/subteams';
import type { Team } from '@service-auth/generated/schemas/team';
import { Button } from '@ui';
import { createMemo, createSignal, For, Match, Show, Switch } from 'solid-js';
import { SettingsCard, SettingsPage, SettingsSection } from './primitives';
import { NewSubteamDialog } from './subteams/new-subteam-dialog';
import { SubteamDetail } from './subteams/subteam-detail';
import { AvatarStack } from './subteams/subteam-mark';
import { SubteamRow } from './subteams/subteam-row';
import { useTeamViewer } from './Team';

/** The workspace's teams, and the open team's detail page. */
export function TeamSubteams(props: { team: Team }) {
  const viewerId = useUserId();
  const viewer = useTeamViewer(() => props.team);
  const subteamsQuery = useSubteamsQuery(() => true);
  const [openSubteamId, setOpenSubteamId] = createSignal<string>();
  const [creating, setCreating] = createSignal(false);

  const subteams = () =>
    queryReadyGate(subteamsQuery) ? subteamsQuery.data : [];
  const topLevel = () => subteams().filter((subteam) => !subteam.parentId);
  const nestedIn = (parentId: string) =>
    subteams().filter((subteam) => subteam.parentId === parentId);
  const open = () =>
    subteams().find((subteam) => subteam.id === openSubteamId());

  const workspaceUserIds = createMemo(() => {
    if (!queryReadyGate(viewer.teamQuery)) return [];
    return viewer.teamQuery.data?.members.map((member) => member.user_id) ?? [];
  });
  const othersInWorkspace = () =>
    workspaceUserIds().filter((userId) => userId !== viewerId());
  const notOnATeam = createMemo(() => {
    const onATeam = new Set(
      subteams().flatMap((subteam) =>
        subteam.members.map((member) => member.userId)
      )
    );
    return workspaceUserIds().filter((userId) => !onATeam.has(userId));
  });

  return (
    <>
      <Show
        when={open()}
        fallback={
          <SettingsPage
            title={t('settingsTeams.title')}
            description={t('settingsTeams.description', {
              workspace: props.team.name,
            })}
            actions={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setCreating(true)}
              >
                <PlusIcon class="size-4" />
                {t('settingsTeams.newTeam')}
              </Button>
            }
          >
            <Switch>
              <Match when={subteamsQuery.isPending}>
                <ListSkeleton.Bar class="h-14 w-full" />
              </Match>
              <Match when={topLevel().length === 0}>
                <SettingsSection>
                  <SettingsCard>
                    <div class="flex flex-col items-center gap-1 px-4 py-8 text-center">
                      <span class="text-sm font-medium text-ink">
                        {t('settingsTeams.empty')}
                      </span>
                      <span class="text-xs text-ink-muted">
                        {t('settingsTeams.emptyDescription')}
                      </span>
                    </div>
                  </SettingsCard>
                </SettingsSection>
              </Match>
              <Match when={true}>
                <SettingsSection>
                  <SettingsCard>
                    <For each={topLevel()}>
                      {(subteam) => (
                        <>
                          <SubteamRow
                            subteam={subteam}
                            onOpen={() => setOpenSubteamId(subteam.id)}
                          />
                          <For each={nestedIn(subteam.id)}>
                            {(child) => (
                              <SubteamRow
                                subteam={child}
                                nested
                                onOpen={() => setOpenSubteamId(child.id)}
                              />
                            )}
                          </For>
                        </>
                      )}
                    </For>
                  </SettingsCard>
                </SettingsSection>
                <Show when={notOnATeam().length > 0}>
                  <SettingsSection title={t('settingsTeams.notOnATeam')}>
                    <SettingsCard>
                      <div class="flex items-center justify-between gap-3 px-4 py-3.5">
                        <AvatarStack userIds={notOnATeam()} max={8} />
                        <span class="text-xs text-ink-muted">
                          {t('settingsTeams.people', {
                            count: notOnATeam().length,
                          })}
                        </span>
                      </div>
                    </SettingsCard>
                  </SettingsSection>
                </Show>
              </Match>
            </Switch>
          </SettingsPage>
        }
      >
        {(subteam) => (
          <SubteamDetail
            subteam={subteam()}
            subteams={subteams()}
            workspaceName={props.team.name}
            workspaceUserIds={workspaceUserIds()}
            viewerId={viewerId()}
            isWorkspaceAdmin={viewer.isAdminOrOwner()}
            onOpen={setOpenSubteamId}
            onBack={() => setOpenSubteamId(undefined)}
          />
        )}
      </Show>
      <NewSubteamDialog
        open={creating()}
        userIds={othersInWorkspace()}
        existingCount={subteams().length}
        onClose={() => setCreating(false)}
        onCreated={(subteam) => setOpenSubteamId(subteam.id)}
      />
    </>
  );
}
