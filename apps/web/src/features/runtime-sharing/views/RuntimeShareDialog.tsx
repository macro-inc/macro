import { SearchBar } from '@app/components/view-shell';
import {
  type AccessLevel,
  shareEntity,
} from '@app/features/access-requests/core/types';
import { createSharingSource } from '@app/features/access-requests/queries/source';
import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import {
  ShareCard,
  ShareDialogFrame,
} from '@core/component/TopBar/ShareDialogFrame';
import { useUserId } from '@core/context/user';
import { getDisplayName, tryMacroId } from '@core/user';
import { fireAndForget } from '@core/util/fireAndForget';
import { OwnerLabel } from '@entity/owner/owner-display';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import {
  useHarnessResidentsQuery,
  useSetHarnessTeamAccessMutation,
} from '@queries/harnesses/harnesses';
import { useCurrentTeamQuery } from '@queries/team/teams';
import type { Harness, HarnessResident } from '@service-storage/client';
import { Button, confirmDialog, Dropdown, ToggleSwitch } from '@ui';
import {
  createMemo,
  createSignal,
  For,
  getOwner,
  type Owner,
  Show,
} from 'solid-js';
import {
  type RuntimeAccessHolders,
  residentsLosingAccessWithTeam,
  residentsLosingAccessWithUser,
} from '../core/residents';

function roleLabel(level: AccessLevel) {
  return level === 'edit'
    ? t('runtimeSharing.roleUser')
    : t('runtimeSharing.roleRead');
}

/** Removing access a resident depends on takes the owner's explicit go-ahead. */
async function confirmShutdown(
  losing: readonly HarnessResident[],
  owner: Owner | null
) {
  if (losing.length === 0) return true;
  const names = losing.map((resident) => resident.name).join(', ');
  return confirmDialog(
    {
      title: t('runtimeSharing.shutDownTitle', { count: losing.length, names }),
      body: t('runtimeSharing.shutDownBody', { count: losing.length, names }),
      confirmLabel: t('runtimeSharing.shutDownConfirm'),
      tone: 'danger',
    },
    // Stacked under the menu, so its Cancel or Escape leaves the menu open.
    { owner }
  );
}

/**
 * The runtime Share menu: the document menu's frame and rows, narrowed to what
 * a runtime allows. No links, no channels, nobody outside the owner's team, and
 * two roles: Read and User.
 */
export function RuntimeShareDialog(props: {
  harness: Harness;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <ShareDialogFrame open={props.open} onOpenChange={props.onOpenChange}>
      <RuntimeShareMenu harness={props.harness} open={props.open} />
    </ShareDialogFrame>
  );
}

function RuntimeShareMenu(props: { harness: Harness; open: boolean }) {
  // Inside the sheet: a warning opened under this owner joins its dismiss
  // stack, so a tap on the warning is not a tap outside the menu.
  const owner = getOwner();
  const userId = useUserId();
  const source = createSharingSource(
    () => shareEntity('harness', props.harness.id),
    () => props.open
  );
  const team = useCurrentTeamQuery(() => props.open);
  const residentsQuery = useHarnessResidentsQuery(
    () => props.harness.id,
    () => props.open
  );
  const setTeamAccess = useSetHarnessTeamAccessMutation();
  const [filter, setFilter] = createSignal('');

  const currentTeam = () => (team.isSuccess ? team.data : undefined);
  const residents = () => (residentsQuery.isSuccess ? residentsQuery.data : []);
  const teamOpen = () => {
    const id = currentTeam()?.team.id;
    return !!id && (props.harness.shared_team_ids ?? []).includes(id);
  };
  const teamAccessHint = (teamName: string) => {
    if (props.harness.is_agent_computer)
      return t('runtimeSharing.agentComputerTeamRead');
    if (teamOpen())
      return t('runtimeSharing.teamMachineOn', { team: teamName });
    return t('runtimeSharing.teamMachineOff');
  };
  const grantedIds = createMemo(() =>
    source.grants().map((grant) => grant.userId)
  );
  // Only users keep a resident running; a reader cannot run anything.
  const canGrantUser = () =>
    !props.harness.is_agent_computer &&
    source.state()?.supportedLevels.includes('edit') === true;
  const userIds = createMemo(() =>
    source
      .grants()
      .filter((grant) => grant.accessLevel === 'edit')
      .map((grant) => grant.userId)
  );
  const holders = (): RuntimeAccessHolders => ({
    ownerId: userId() ?? '',
    grantedUserIds: userIds(),
    teamMemberIds:
      teamOpen() && !props.harness.is_agent_computer
        ? (currentTeam()?.members.map((member) => member.user_id) ?? [])
        : [],
  });
  const addable = () => {
    const query = filter().trim().toLowerCase();
    return (currentTeam()?.members ?? [])
      .map((member) => member.user_id)
      .filter(
        (id) =>
          id !== userId() &&
          !grantedIds().includes(id) &&
          getDisplayName(tryMacroId(id)).toLowerCase().includes(query)
      );
  };

  const report = async (write: () => Promise<unknown>) => {
    try {
      await write();
    } catch {
      toast.failure(t('runtimeSharing.writeFailed'));
    }
  };
  const removePerson = async (id: string) => {
    const go = await confirmShutdown(
      residentsLosingAccessWithUser(residents(), holders(), id),
      owner
    );
    if (go) await report(() => source.setGrant(id, null));
  };
  const makeReader = async (id: string) => {
    const go = await confirmShutdown(
      residentsLosingAccessWithUser(residents(), holders(), id),
      owner
    );
    if (go) await report(() => source.setGrant(id, 'view'));
  };
  const toggleTeam = async (enabled: boolean) => {
    const teamId = currentTeam()?.team.id;
    if (!teamId) return;
    if (!enabled) {
      const go = await confirmShutdown(
        residentsLosingAccessWithTeam(residents(), holders(), teamId),
        owner
      );
      if (!go) return;
    }
    await report(() =>
      setTeamAccess.mutateAsync({
        harnessId: props.harness.id,
        teamId,
        enabled,
      })
    );
  };
  const decide = (requestId: string, level: AccessLevel | null) => {
    const request = source
      .state()
      ?.requests.find((candidate) => candidate.id === requestId);
    if (!request) return;
    fireAndForget(
      report(() => source.resolve(request, level)),
      'runtime-sharing'
    );
  };

  return (
    <ShareCard
      header={
        <span class="text-sm font-medium text-ink">
          {t('runtimeSharing.shareTitle', { name: props.harness.name })}
        </span>
      }
      bodyClass="flex flex-col gap-4 p-4"
    >
      <p class="text-sm text-ink-muted">
        {props.harness.is_agent_computer
          ? t('runtimeSharing.agentComputerExplain')
          : t('runtimeSharing.explain')}
      </p>

      <Show when={currentTeam()}>
        {(current) => (
          <div class="flex items-center justify-between gap-3">
            <div class="flex min-w-0 flex-col gap-1">
              <span class="font-medium text-ink">
                {t('runtimeSharing.teamMachine')}
              </span>
              <span class="text-sm text-ink-muted">
                {teamAccessHint(current().team.name)}
              </span>
            </div>
            <ToggleSwitch
              label={t('runtimeSharing.teamMachine')}
              labelClass="sr-only"
              checked={teamOpen()}
              disabled={setTeamAccess.isPending}
              onChange={(enabled) =>
                fireAndForget(toggleTeam(enabled), 'runtime-sharing')
              }
            />
          </div>
        )}
      </Show>

      <section
        class="flex flex-col gap-2"
        aria-label={t('runtimeSharing.people')}
      >
        <div class="flex items-center justify-between gap-2">
          <OwnerLabel ownerId={userId() ?? ''} />
          <span class="text-xs text-ink-muted">
            {t('runtimeSharing.owner')}
          </span>
        </div>
        <For each={residents()}>
          {(resident) => (
            <div
              class="flex items-center justify-between gap-2"
              data-runtime-resident
            >
              <span class="min-w-0 truncate text-sm text-ink">
                {resident.name}
              </span>
              <span class="text-xs text-ink-muted">
                {t('runtimeSharing.resident')}
              </span>
            </div>
          )}
        </For>
        <For each={source.grants()}>
          {(grant) => (
            <div
              class="flex flex-wrap items-center justify-between gap-2"
              data-runtime-grant
            >
              <OwnerLabel ownerId={grant.userId} />
              <div class="flex items-center gap-2">
                <Show
                  when={!teamOpen() || props.harness.is_agent_computer}
                  fallback={
                    <span class="text-xs text-ink-muted">
                      {t('runtimeSharing.roleUserTeamMachine')}
                    </span>
                  }
                >
                  <Dropdown>
                    <Dropdown.Trigger
                      variant="secondary"
                      disabled={source.busy() || !source.state()}
                      aria-label={t('runtimeSharing.role')}
                    >
                      {roleLabel(grant.accessLevel)}
                      <CaretDownIcon class="size-3.5" aria-hidden="true" />
                    </Dropdown.Trigger>
                    <Dropdown.Content portalScope="local">
                      <Dropdown.Group>
                        <Show when={canGrantUser()}>
                          <Dropdown.Item
                            onSelect={() =>
                              fireAndForget(
                                report(() =>
                                  source.setGrant(grant.userId, 'edit')
                                ),
                                'runtime-sharing'
                              )
                            }
                          >
                            {t('runtimeSharing.roleUser')}
                          </Dropdown.Item>
                        </Show>
                        <Dropdown.Item
                          onSelect={() =>
                            fireAndForget(
                              makeReader(grant.userId),
                              'runtime-sharing'
                            )
                          }
                        >
                          {t('runtimeSharing.roleRead')}
                        </Dropdown.Item>
                      </Dropdown.Group>
                    </Dropdown.Content>
                  </Dropdown>
                </Show>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={source.busy() || !source.state()}
                  onClick={() =>
                    fireAndForget(removePerson(grant.userId), 'runtime-sharing')
                  }
                >
                  {t('runtimeSharing.remove')}
                </Button>
              </div>
            </div>
          )}
        </For>
      </section>

      <Show when={(source.state()?.requests.length ?? 0) > 0}>
        <section
          class="flex flex-col gap-2"
          aria-label={t('runtimeSharing.requests')}
        >
          <h3 class="font-medium text-ink">{t('runtimeSharing.requests')}</h3>
          <For each={source.state()?.requests ?? []}>
            {(request) => (
              <div
                class="flex flex-wrap items-center justify-between gap-2"
                data-runtime-request
              >
                <div class="flex min-w-0 flex-col gap-1">
                  <OwnerLabel ownerId={request.requesterId} />
                  <span class="text-xs text-ink-muted">
                    {t('runtimeSharing.requestedRole', {
                      role: roleLabel(request.requestedLevel),
                    })}
                  </span>
                  <Show when={request.requestedByAgent}>
                    <span class="text-xs text-ink-muted">
                      {t('runtimeSharing.viaAgent')}
                    </span>
                  </Show>
                </div>
                <div class="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={source.busy() || !source.state()}
                    onClick={() => decide(request.id, null)}
                  >
                    {t('runtimeSharing.deny')}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={
                      source.busy() ||
                      !source
                        .state()
                        ?.supportedLevels.includes(request.requestedLevel)
                    }
                    onClick={() => decide(request.id, request.requestedLevel)}
                  >
                    {t('runtimeSharing.approve')}
                  </Button>
                </div>
              </div>
            )}
          </For>
        </section>
      </Show>

      <section
        class="flex flex-col gap-2"
        aria-label={t('runtimeSharing.addTeammates')}
      >
        <h3 class="font-medium text-ink">{t('runtimeSharing.addTeammates')}</h3>
        <SearchBar
          label={t('runtimeSharing.filterTeammates')}
          placeholder={t('runtimeSharing.filterTeammates')}
          value={filter()}
          onValueChange={setFilter}
        />
        <Show
          when={addable().length > 0}
          fallback={
            <p class="text-sm text-ink-muted">
              {t('runtimeSharing.noTeammates')}
            </p>
          }
        >
          <div class="flex max-h-56 flex-col gap-1 overflow-y-auto">
            <For each={addable()}>
              {(id) => (
                <div
                  class="flex items-center justify-between gap-2 touch:min-h-[44px]"
                  data-runtime-teammate
                >
                  <OwnerLabel ownerId={id} />
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={source.busy() || !source.state()}
                    onClick={() =>
                      fireAndForget(
                        report(() =>
                          source.setGrant(id, canGrantUser() ? 'edit' : 'view')
                        ),
                        'runtime-sharing'
                      )
                    }
                  >
                    {t('runtimeSharing.add')}
                  </Button>
                </div>
              )}
            </For>
          </div>
        </Show>
      </section>

      <Show when={source.error()}>
        <p role="alert" class="text-xs text-failure-ink">
          {t('runtimeSharing.loadFailed')}
        </p>
      </Show>
    </ShareCard>
  );
}
