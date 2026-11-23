import { t } from '@app/lib/i18n';
import {
  beginInteraction,
  TraceFlow,
  usePending,
} from '@app/observability/flow';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import ArrowCounterClockwiseIcon from '@icon/system/regular/arrow-counter-clockwise.svg';
import LockIcon from '@icon/system/regular/lock-simple.svg';
import { queryReadyGate } from '@queries/gate';
import type {
  TeamToolPermissions,
  ToolPermissionCatalog,
} from '@service-agent-harness/generated/schemas';
import { Button } from '@ui';
import { ResultAsync } from 'neverthrow';
import { createSignal, Match, Show, Switch } from 'solid-js';
import { PermissionsLoadError } from '../components/permissions-notes';
import { PermissionsSkeleton } from '../components/permissions-skeleton';
import { ResetPermissionsDialog } from '../components/reset-permissions-dialog';
import { ToolPermissions } from '../components/tool-permissions';
import { settingCounts, targetKey } from '../core/model';
import { useToolPermissionCatalogQuery } from '../queries/permissions';
import {
  useResetTeamPermissionsMutation,
  useSetTeamPermissionsMutation,
  useTeamToolPermissionsQuery,
} from '../queries/team';
import { refusalMessage, usePolicyChanges } from './permission-changes';

type PanelData =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'unavailable' }
  | {
      kind: 'ready';
      catalog: ToolPermissionCatalog;
      view: TeamToolPermissions;
    };

const EMPTY_CATALOG: ToolPermissionCatalog = {
  version: '',
  actions: [],
  groups: [],
};

/**
 * A team's default permissions, inline under its row in Settings → Agents:
 * the same action defaults and exceptions as an agent's. Team agents that
 * follow the team default use them. Team admins and owners change them;
 * other members read them.
 */
export function TeamPermissionsPanel(props: { teamId: string }) {
  const catalogQuery = useToolPermissionCatalogQuery();
  const viewQuery = useTeamToolPermissionsQuery(() => props.teamId);
  const setMutation = useSetTeamPermissionsMutation(() => props.teamId);
  const resetMutation = useResetTeamPermissionsMutation(() => props.teamId);
  const [confirmingReset, setConfirmingReset] = createSignal(false);

  // Cached data stays on screen through a failed refetch (FE-48).
  const data = (): PanelData => {
    if (catalogQuery.isPending || viewQuery.isPending) {
      if (catalogQuery.isError || viewQuery.isError) return { kind: 'error' };
      return { kind: 'loading' };
    }
    if (!queryReadyGate(catalogQuery) || !queryReadyGate(viewQuery)) {
      return { kind: 'error' };
    }
    const catalog = catalogQuery.data;
    const view = viewQuery.data;
    if (!catalog || !view) return { kind: 'unavailable' };
    return { kind: 'ready', catalog, view };
  };

  const ready = () => {
    const current = data();
    return current.kind === 'ready' ? current : undefined;
  };
  const canEdit = () => ready()?.view.canEdit ?? false;
  const counts = () => {
    const current = ready();
    if (!current) return { total: 0, byPerson: 0, byAgent: 0 };
    return settingCounts(current.catalog, current.view.rules);
  };
  const anySaved = () => (ready()?.view.rules.length ?? 0) > 0;

  const changes = usePolicyChanges({
    mutate: (variables) =>
      setMutation.mutateAsync({ teamId: props.teamId, ...variables }),
    catalog: () => ready()?.catalog ?? EMPTY_CATALOG,
    view: () => ready()?.view,
  });

  const retry = () => {
    if (catalogQuery.isError)
      fireAndForget(catalogQuery.refetch(), 'agent-permissions');
    if (viewQuery.isError)
      fireAndForget(viewQuery.refetch(), 'agent-permissions');
  };

  const reset = async () => {
    const interaction = beginInteraction('agent_permissions.reset_team');
    const result = await ResultAsync.fromPromise(
      resetMutation.mutateAsync({
        teamId: props.teamId,
        trace: interaction.span,
      }),
      (error) => error
    );
    interaction.end();
    if (result.isErr()) {
      toast.failure(t('agentPermissions.resetFailed'), {
        subtext: refusalMessage(result.error),
      });
      return;
    }
    setConfirmingReset(false);
    toast.success(t('agentPermissions.resetDone'));
  };

  return (
    <TraceFlow
      name="view.agent_permissions"
      attributes={{ 'agent_permissions.agent_kind': 'team' }}
    >
      <LoadPhase pending={() => data().kind === 'loading'} />
      <div class="flex flex-col gap-3">
        <Switch>
          <Match when={data().kind === 'loading'}>
            <PermissionsSkeleton />
          </Match>
          <Match when={data().kind === 'error'}>
            <PermissionsLoadError onRetry={retry} />
          </Match>
          <Match when={data().kind === 'unavailable'}>
            <p class="px-1 text-sm text-ink-muted">
              {t('agentPermissions.teamUnavailable')}
            </p>
          </Match>
          <Match when={ready()}>
            {(loaded) => (
              <>
                <ToolPermissions
                  catalog={loaded().catalog}
                  view={loaded().view}
                  editable={loaded().view.canEdit}
                  pendingState={(target) =>
                    changes.pendingState(targetKey(target))
                  }
                  onChange={(change, shown) =>
                    fireAndForget(
                      changes.apply(change.target, shown, change),
                      'agent-permissions'
                    )
                  }
                />
                <Show when={!canEdit()}>
                  <p class="flex items-center gap-2 px-1 text-xs text-ink-extra-muted">
                    <LockIcon aria-hidden="true" class="size-3.5 shrink-0" />
                    {t('agentPermissions.teamReadOnly')}
                  </p>
                </Show>
                <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-1">
                  <p class="text-xs text-ink-extra-muted">
                    <Show when={counts().byPerson > 0}>
                      {t('agentPermissions.settingsChanged', {
                        count: counts().byPerson,
                      })}
                    </Show>
                  </p>
                  <Show when={canEdit() && anySaved()}>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmingReset(true)}
                    >
                      <ArrowCounterClockwiseIcon class="size-3.5 shrink-0 pointer-events-none" />
                      {t('agentPermissions.reset')}
                    </Button>
                  </Show>
                </div>
                <p class="px-1 text-xs text-ink-extra-muted">
                  {t('agentPermissions.teamScopeNote')}
                </p>
              </>
            )}
          </Match>
        </Switch>
      </div>
      <ResetPermissionsDialog
        open={confirmingReset()}
        agent={t('agentPermissions.teamDefault')}
        title={t('agentPermissions.resetTeamTitle')}
        team
        followed
        byAgent={0}
        pending={resetMutation.isPending}
        onOpenChange={setConfirmingReset}
        onConfirm={() => fireAndForget(reset(), 'agent-permissions')}
      />
    </TraceFlow>
  );
}

/** Holds the view's flow open while its data loads. */
function LoadPhase(props: { pending: () => boolean }) {
  usePending('agent_permissions.load', props.pending);
  return null;
}
