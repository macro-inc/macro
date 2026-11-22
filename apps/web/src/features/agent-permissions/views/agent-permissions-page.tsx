import { SearchBar } from '@app/components/view-shell/SearchBar';
import { t } from '@app/lib/i18n';
import {
  beginInteraction,
  TraceFlow,
  usePending,
} from '@app/observability/flow';
import { toast } from '@core/component/Toast/Toast';
import { debouncedDependent } from '@core/util/debounce';
import { fireAndForget } from '@core/util/fireAndForget';
import ArrowCounterClockwiseIcon from '@icon/system/regular/arrow-counter-clockwise.svg';
import RobotIcon from '@icon/system/regular/robot.svg';
import { queryReadyGate } from '@queries/gate';
import type {
  AgentToolPermissions,
  ToolPermissionCatalog,
} from '@service-agent-harness/generated/schemas';
import { Button } from '@ui';
import { ResultAsync } from 'neverthrow';
import { createSignal, Match, Show, Switch } from 'solid-js';
import { SettingsCard, SettingsPage } from '../../settings/primitives';
import {
  PermissionsLoadError,
  PermissionsReadOnlyNote,
  PermissionsScopeNote,
} from '../components/permissions-notes';
import { PermissionsSkeleton } from '../components/permissions-skeleton';
import { ResetPermissionsDialog } from '../components/reset-permissions-dialog';
import { RichText } from '../components/rich-text';
import { searchPermissions, settingCounts } from '../core/model';
import {
  useAgentToolPermissionsQuery,
  useResetAgentToolPermissionsMutation,
  useToolPermissionCatalogQuery,
} from '../queries/permissions';
import {
  AgentPermissionsList,
  type PermissionFocus,
} from './agent-permissions-list';
import { refusalMessage, usePermissionChanges } from './permission-changes';

const SEARCH_DEBOUNCE_MS = 120;

type PageData =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'unavailable' }
  | {
      kind: 'ready';
      catalog: ToolPermissionCatalog;
      view: AgentToolPermissions;
    };

/**
 * An agent's permissions: what it may do in its JS tools programs, per group and
 * action, with each group's individual tools. Changes save on each click.
 */
export function AgentPermissionsPage(props: {
  agentId: string;
  agentName: string;
  backLabel: string;
  onBack: () => void;
  focus?: PermissionFocus;
  /** A built-in persona (Macro) rather than an agent someone made. */
  persona?: boolean;
}) {
  const catalogQuery = useToolPermissionCatalogQuery();
  const viewQuery = useAgentToolPermissionsQuery(() => props.agentId);
  const resetMutation = useResetAgentToolPermissionsMutation(
    () => props.agentId
  );

  const [search, setSearch] = createSignal('');
  const query = debouncedDependent(search, SEARCH_DEBOUNCE_MS);
  const [confirmingReset, setConfirmingReset] = createSignal(false);
  let body: HTMLDivElement | undefined;

  // Cached data stays on screen through a failed refetch (FE-48).
  const data = (): PageData => {
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
  const counts = () => settingCounts(ready()?.view.rules ?? []);

  const changes = usePermissionChanges({
    agentId: () => props.agentId,
    catalog: () => ready()?.catalog ?? { version: '', actions: [], groups: [] },
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
    // The Reset button is disabled now; keep focus on the page.
    body?.focus({ preventScroll: true });
  };

  const searchStatus = () => {
    const current = ready();
    const text = query().trim();
    if (!current || !text) return undefined;
    const result = searchPermissions(current.catalog, text);
    if (result.groupCount === 0) return undefined;
    return t('agentPermissions.searchStatus', {
      groups: t('agentPermissions.matchGroups', { count: result.groupCount }),
      tools: t('agentPermissions.matchTools', { count: result.toolCount }),
      query: text,
    });
  };

  return (
    <TraceFlow
      name="view.agent_permissions"
      attributes={{
        'agent_permissions.agent_kind': props.persona ? 'persona' : 'agent',
      }}
    >
      <LoadPhase pending={() => data().kind === 'loading'} />
      <SettingsPage
        title={t('agentPermissions.title')}
        showTitleInSheet
        onBack={props.onBack}
        backLabel={props.backLabel}
        description={
          <RichText
            message={t('agentPermissions.description', {
              agent: props.agentName,
            })}
          />
        }
        signpost={
          <Show when={counts().total > 0}>
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
                  <RobotIcon aria-hidden="true" class="size-3.5" />
                  {t('agentPermissions.setByAgentCount', {
                    count: counts().byAgent,
                    agent: props.agentName,
                  })}
                </span>
              </Show>
            </p>
          </Show>
        }
        actions={
          <Show when={canEdit()}>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={counts().total === 0}
              tooltip={
                counts().total === 0
                  ? t('agentPermissions.nothingToReset')
                  : undefined
              }
              onClick={() => setConfirmingReset(true)}
            >
              <ArrowCounterClockwiseIcon class="size-3.5 touch:size-5 shrink-0 pointer-events-none" />
              {t('agentPermissions.reset')}
            </Button>
          </Show>
        }
      >
        <div ref={body} tabIndex={-1} class="flex flex-col gap-4 outline-none">
          <PermissionsScopeNote agent={props.agentName} />
          <Show when={ready() && !canEdit()}>
            <PermissionsReadOnlyNote agent={props.agentName} />
          </Show>
          <Switch>
            <Match when={data().kind === 'unavailable'}>
              <p class="px-1 text-sm text-ink-muted">
                {t('agentPermissions.unavailable')}
              </p>
            </Match>
            <Match when={true}>
              <SearchBar
                label={t('agentPermissions.searchLabel')}
                placeholder={t('agentPermissions.searchPlaceholder')}
                value={search()}
                onValueChange={setSearch}
                onEscape={() => setSearch('')}
              />
              <Show when={searchStatus()}>
                {(status) => (
                  <p
                    role="status"
                    class="-mt-1 px-1 text-xs text-ink-extra-muted"
                  >
                    {status()}
                  </p>
                )}
              </Show>
              <SettingsCard>
                <Switch>
                  <Match when={data().kind === 'loading'}>
                    <PermissionsSkeleton />
                  </Match>
                  <Match when={data().kind === 'error'}>
                    <PermissionsLoadError onRetry={retry} />
                  </Match>
                  <Match when={ready()}>
                    {(loaded) => (
                      <AgentPermissionsList
                        agentName={props.agentName}
                        catalog={loaded().catalog}
                        view={loaded().view}
                        canEdit={loaded().view.canEdit}
                        changes={changes}
                        query={query()}
                        onClearSearch={() => setSearch('')}
                        focus={props.focus}
                      />
                    )}
                  </Match>
                </Switch>
              </SettingsCard>
            </Match>
          </Switch>
        </div>
      </SettingsPage>
      <ResetPermissionsDialog
        open={confirmingReset()}
        agent={props.agentName}
        counts={counts()}
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
