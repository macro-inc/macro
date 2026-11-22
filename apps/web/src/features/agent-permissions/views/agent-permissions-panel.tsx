import { t } from '@app/lib/i18n';
import {
  beginInteraction,
  TraceFlow,
  usePending,
} from '@app/observability/flow';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import ArrowCounterClockwiseIcon from '@icon/system/regular/arrow-counter-clockwise.svg';
import RobotIcon from '@icon/system/regular/robot.svg';
import { queryReadyGate } from '@queries/gate';
import type { ToolPermissionCatalog } from '@service-agent-harness/generated/schemas';
import { Button } from '@ui';
import { ResultAsync } from 'neverthrow';
import { createSignal, Match, Show, Switch } from 'solid-js';
import {
  PermissionsLoadError,
  PermissionsReadOnlyNote,
  PermissionsScopeNote,
} from '../components/permissions-notes';
import { PermissionsSkeleton } from '../components/permissions-skeleton';
import { ResetPermissionsDialog } from '../components/reset-permissions-dialog';
import { ToolPermissions } from '../components/tool-permissions';
import {
  focusedAction,
  type PermissionFocus,
  settingCounts,
  targetKey,
} from '../core/model';
import {
  useAgentToolPermissionsQuery,
  useResetAgentToolPermissionsMutation,
  useToolPermissionCatalogQuery,
} from '../queries/permissions';
import type { PermissionsView } from '../queries/permissions-view';
import { refusalMessage, usePermissionChanges } from './permission-changes';

type PanelData =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'unavailable' }
  | {
      kind: 'ready';
      catalog: ToolPermissionCatalog;
      view: PermissionsView;
    };

const EMPTY_CATALOG: ToolPermissionCatalog = {
  version: '',
  actions: [],
  groups: [],
};

/**
 * An agent's tool permissions, shown inline under its row in Settings →
 * Agents (and in its editor): action defaults with entity exceptions.
 * Changes save on each click; someone who can't edit the agent reads them.
 */
export function AgentPermissionsPanel(props: {
  agentId: string;
  agentName: string;
  /** A built-in persona (Macro) rather than an agent someone made. */
  persona?: boolean;
  /** Where a link pointed: its action starts expanded. */
  focus?: PermissionFocus;
  /** Shows the "Tool permissions" title and its description. */
  heading?: boolean;
}) {
  const catalogQuery = useToolPermissionCatalogQuery();
  const viewQuery = useAgentToolPermissionsQuery(() => props.agentId);
  const resetMutation = useResetAgentToolPermissionsMutation(
    () => props.agentId
  );
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
  // Reset clears hidden rules too, so it's offered while any rule is saved.
  const anySaved = () => (ready()?.view.rules.length ?? 0) > 0;

  const changes = usePermissionChanges({
    agentId: () => props.agentId,
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
    const interaction = beginInteraction('agent_permissions.reset');
    const result = await ResultAsync.fromPromise(
      resetMutation.mutateAsync({
        agentId: props.agentId,
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
      attributes={{
        'agent_permissions.agent_kind': props.persona ? 'persona' : 'agent',
      }}
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
              {t('agentPermissions.unavailable')}
            </p>
          </Match>
          <Match when={ready()}>
            {(loaded) => (
              <>
                <ToolPermissions
                  catalog={loaded().catalog}
                  view={loaded().view}
                  editable={loaded().view.canEdit}
                  heading={props.heading}
                  initialAction={
                    props.focus
                      ? focusedAction(loaded().catalog, props.focus)
                      : undefined
                  }
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
                  <PermissionsReadOnlyNote agent={props.agentName} />
                </Show>
                <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-1">
                  <p class="flex flex-wrap items-center gap-x-1.5 text-xs text-ink-extra-muted">
                    {/* Settings people made, then the agent's own restrictions. */}
                    <Show when={counts().byPerson > 0}>
                      {t('agentPermissions.settingsChanged', {
                        count: counts().byPerson,
                      })}
                    </Show>
                    <Show when={counts().byAgent > 0}>
                      <Show when={counts().byPerson > 0}>
                        <span aria-hidden="true">·</span>
                      </Show>
                      <span class="inline-flex items-center gap-1">
                        <RobotIcon aria-hidden="true" class="size-3" />
                        {t('agentPermissions.setByAgentCount', {
                          count: counts().byAgent,
                          agent: props.agentName,
                        })}
                      </span>
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
                <PermissionsScopeNote agent={props.agentName} />
              </>
            )}
          </Match>
        </Switch>
      </div>
      <ResetPermissionsDialog
        open={confirmingReset()}
        agent={props.agentName}
        byAgent={counts().byAgent}
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
