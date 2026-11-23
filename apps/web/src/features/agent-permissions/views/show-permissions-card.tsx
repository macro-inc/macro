import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import ArrowCounterClockwiseIcon from '@icon/system/regular/arrow-counter-clockwise.svg';
import ArrowSquareOutIcon from '@icon/system/regular/arrow-square-out.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import LinkIcon from '@icon/system/regular/link-simple.svg';
import LockIcon from '@icon/system/regular/lock-simple.svg';
import ShieldCheckIcon from '@icon/system/regular/shield-check.svg';
import { queryReadyGate } from '@queries/gate';
import type {
  AgentToolPermissions,
  PermissionAction,
  ShowPermissionsSelection,
  ToolPermissionCatalog,
  ToolPermissionCatalogTool,
  ToolPermissionState,
} from '@service-agent-harness/generated/schemas';
import { Button } from '@ui';
import { For, type JSX, Match, Show, Switch } from 'solid-js';
import { sourceMention } from '../components/following-note';
import { groupIcon } from '../components/group-icon';
import { stateLabel } from '../components/labels';
import { PermissionActionRow } from '../components/permission-action-row';
import {
  PermissionToolRow,
  type ToolRowStatus,
} from '../components/permission-tool-row';
import type { PermissionFocus } from '../core/model';
import {
  actionPermission,
  changeForException,
  groupActionTarget,
  groupPermissions,
  ruleFor,
  targetKey,
  toolKey,
  toolOverride,
  toolTarget,
} from '../core/model';
import { type SelectionBlock, selectionBlocks } from '../core/selection';
import {
  useSessionToolPermissionsQuery,
  useToolPermissionCatalogQuery,
} from '../queries/permissions';
import { useOpenAgentPermissions } from './open-agent-permissions';
import { usePermissionChanges } from './permission-changes';

type CardData =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'unavailable' }
  | {
      kind: 'ready';
      catalog: ToolPermissionCatalog;
      view: AgentToolPermissions;
    };

/**
 * The permissions an agent asked a person to look at (its ShowPermissions
 * call), with the same live controls as its permissions page. They read the
 * session's view, so the agent's own limits for this session show, and save
 * to the agent itself; someone who can't edit the agent sees them read-only.
 */
export function ShowPermissionsCard(props: {
  sessionId: string;
  agentName: string;
  selection: ShowPermissionsSelection;
  reason?: string | null;
}) {
  const catalogQuery = useToolPermissionCatalogQuery();
  const viewQuery = useSessionToolPermissionsQuery(() => props.sessionId);
  const openPermissions = useOpenAgentPermissions();

  // Cached data stays on screen through a failed refetch (FE-48).
  const data = (): CardData => {
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
  // A following agent's permissions are its source's: read-only here, as in
  // its settings (its own restrictions are removed there).
  const source = () => ready()?.view.source ?? undefined;
  const canChange = () => canEdit() && !source();
  const blocks = () => {
    const current = ready();
    return current ? selectionBlocks(current.catalog, props.selection) : [];
  };

  const changes = usePermissionChanges({
    agentId: () => ready()?.view.agentId ?? '',
    catalog: () => ready()?.catalog ?? { version: '', actions: [], groups: [] },
    view: () => ready()?.view,
  });

  const retry = () => {
    if (catalogQuery.isError)
      fireAndForget(catalogQuery.refetch(), 'agent-permissions');
    if (viewQuery.isError)
      fireAndForget(viewQuery.refetch(), 'agent-permissions');
  };

  const focus = (): PermissionFocus | undefined => {
    const first = blocks()[0];
    if (!first) return undefined;
    const tool = first.tools[0];
    return {
      group: first.group.id,
      action: first.actions[0] ?? tool?.action,
      tool: first.actions.length === 0 && tool ? tool : undefined,
    };
  };
  const openAll = () => {
    const agentId = ready()?.view.agentId;
    if (agentId) openPermissions(agentId, focus());
  };

  const title = () =>
    t('agentPermissionsChat.cardTitle', { agent: props.agentName });

  return (
    <section
      aria-label={title()}
      class="@container/card min-w-0 overflow-hidden rounded-xl border border-edge-muted bg-panel text-ink"
    >
      <div class="flex items-start gap-3 px-4 pt-4">
        <div class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-ink/5 text-ink-muted">
          <ShieldCheckIcon aria-hidden="true" class="size-4" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
            <div class="min-w-0 flex-1 basis-60">
              <div class="text-sm font-medium">{title()}</div>
              <p class="mt-0.5 text-sm leading-5 text-ink-muted [overflow-wrap:anywhere]">
                {t('agentPermissionsChat.cardBody', {
                  agent: props.agentName,
                })}
              </p>
            </div>
            <Show when={canEdit()}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                class="-mt-1 shrink-0 gap-1.5"
                onClick={openAll}
              >
                {t('agentPermissionsChat.allPermissions')}
                <ArrowSquareOutIcon
                  aria-hidden="true"
                  class="size-3.5 touch:size-4 shrink-0 pointer-events-none"
                />
              </Button>
            </Show>
          </div>
          <Show when={props.reason}>
            {(reason) => (
              <blockquote class="mt-2 border-l-2 border-edge-muted pl-3 text-sm leading-5 text-ink-muted [overflow-wrap:anywhere]">
                “{reason()}”
              </blockquote>
            )}
          </Show>
        </div>
      </div>
      <Switch>
        <Match when={data().kind === 'unavailable'}>
          <p class="px-4 pt-3 pb-4 text-sm text-ink-muted @min-[420px]/card:pl-15">
            {t('agentPermissionsChat.cardUnavailable')}
          </p>
        </Match>
        <Match when={data().kind === 'error'}>
          <div class="flex flex-wrap items-center gap-2 px-4 pt-3 pb-4 text-sm text-ink-muted @min-[420px]/card:pl-15">
            {t('agentPermissionsChat.cardLoadFailed')}
            <Button type="button" variant="ghost" size="sm" onClick={retry}>
              <ArrowCounterClockwiseIcon
                aria-hidden="true"
                class="size-3.5 shrink-0 pointer-events-none"
              />
              {t('agentPermissionsChat.tryAgain')}
            </Button>
          </div>
        </Match>
        <Match when={true}>
          <div class="mx-4 mt-3 rounded-lg border border-edge-muted">
            <Switch>
              <Match when={data().kind === 'loading'}>
                <ListSkeleton.Root label={t('agentPermissionsChat.loading')}>
                  <div class="flex flex-col gap-3 px-3 py-3">
                    <ListSkeleton.Bar class="h-3 w-24" />
                    <ListSkeleton.Bar class="h-7 w-full" />
                    <ListSkeleton.Bar class="h-7 w-full" />
                  </div>
                </ListSkeleton.Root>
              </Match>
              <Match when={ready()}>
                {(loaded) => (
                  <div class="divide-y divide-edge-muted">
                    {/* Keyed by group id: the blocks are rebuilt on every
                        read of the view, and a remount would drop focus
                        from the control just clicked. */}
                    <For each={blocks().map((block) => block.group.id)}>
                      {(groupId) => (
                        <Show
                          when={blocks().find(
                            (block) => block.group.id === groupId
                          )}
                        >
                          {(block) => (
                            <SelectionGroup
                              block={block()}
                              catalog={loaded().catalog}
                              view={loaded().view}
                              agentName={props.agentName}
                              canEdit={canChange()}
                              pendingState={changes.pendingState}
                              onAction={(group, action, state) =>
                                fireAndForget(
                                  changes.apply(
                                    groupActionTarget(group, action),
                                    state,
                                    // An explicit choice is kept, even one
                                    // equal to the action's default.
                                    changeForException(group, action, state)
                                  ),
                                  'agent-permissions'
                                )
                              }
                              onTool={(group, tool, saved, state) =>
                                fireAndForget(
                                  changes.setTool(
                                    groupActionTarget(group, tool.action),
                                    saved,
                                    tool,
                                    state
                                  ),
                                  'agent-permissions'
                                )
                              }
                              onClearTool={(tool, shown) =>
                                fireAndForget(
                                  changes.apply(toolTarget(tool), shown, {
                                    target: toolTarget(tool),
                                    state: null,
                                  }),
                                  'agent-permissions'
                                )
                              }
                            />
                          )}
                        </Show>
                      )}
                    </For>
                  </div>
                )}
              </Match>
            </Switch>
          </div>
        </Match>
      </Switch>
      <Show when={ready()}>
        <p class="flex items-center gap-1.5 px-4 py-3 text-xs leading-4 text-ink-extra-muted">
          <Switch>
            <Match when={source()}>
              {(followed) => (
                <>
                  <LinkIcon aria-hidden="true" class="size-3.5 shrink-0" />
                  {t('agentPermissionsChat.cardFollows', {
                    agent: props.agentName,
                    source: sourceMention(followed()),
                  })}
                </>
              )}
            </Match>
            <Match when={canEdit()}>
              <CheckIcon aria-hidden="true" class="size-3.5 shrink-0" />
              {t('agentPermissionsChat.cardSaves', { agent: props.agentName })}
            </Match>
            <Match when={true}>
              <LockIcon aria-hidden="true" class="size-3.5 shrink-0" />
              {t('agentPermissionsChat.cardReadOnly', {
                agent: props.agentName,
              })}
            </Match>
          </Switch>
        </p>
      </Show>
    </section>
  );
}

/** One group of the card: its header, the asked actions, the asked tools. */
function SelectionGroup(props: {
  block: SelectionBlock;
  catalog: ToolPermissionCatalog;
  view: AgentToolPermissions;
  agentName: string;
  canEdit: boolean;
  pendingState: (key: string) => ToolPermissionState | undefined;
  onAction: (
    group: string,
    action: PermissionAction,
    state: ToolPermissionState
  ) => void;
  onTool: (
    group: string,
    tool: ToolPermissionCatalogTool,
    saved: ToolPermissionState,
    state: ToolPermissionState
  ) => void;
  onClearTool: (
    tool: ToolPermissionCatalogTool,
    shown: ToolPermissionState
  ) => void;
}) {
  const Icon = groupIcon(props.block.group.id);
  const groupId = () => props.block.group.id;
  const actionName = (action: PermissionAction) =>
    props.catalog.actions.find((entry) => entry.action === action)?.name ??
    action;
  const permission = (action: PermissionAction) =>
    actionPermission(groupPermissions(props.view, groupId()), action);
  const actionState = (action: PermissionAction): ToolPermissionState =>
    props.pendingState(targetKey(groupActionTarget(groupId(), action))) ??
    permission(action)?.state ??
    'always';

  const toolRow = (tool: ToolPermissionCatalogTool): JSX.Element => {
    const key = targetKey(toolTarget(tool));
    const action = () => permission(tool.action);
    const rule = () => ruleFor(props.view.rules, toolTarget(tool));
    const override = () => {
      const current = action();
      return current ? toolOverride(current, tool) : undefined;
    };
    const status = (): ToolRowStatus => {
      const current = action();
      if (current && override()) {
        return {
          kind: 'differs',
          action: actionName(tool.action),
          actionState: stateLabel(current.state),
        };
      }
      if (rule()) return { kind: 'own' };
      return { kind: 'follows', action: actionName(tool.action) };
    };
    const shown = () =>
      props.pendingState(key) ?? override()?.state ?? actionState(tool.action);
    return (
      <PermissionToolRow
        rowKey={key}
        label={tool.label}
        operation={toolKey(tool)}
        controlLabel={tool.label}
        state={shown()}
        status={status()}
        byAgent={rule()?.viaAgent}
        clearLabel={t('agentPermissions.useActionSetting', {
          action: actionName(tool.action),
        })}
        onClear={
          rule() && action() && props.canEdit
            ? () => {
                const current = action();
                if (current) props.onClearTool(tool, current.state);
              }
            : undefined
        }
        disabled={!props.canEdit || !action()}
        onChange={(state) => {
          const current = action();
          if (current) props.onTool(groupId(), tool, current.state, state);
        }}
      />
    );
  };

  return (
    <div
      data-permission-group={groupId()}
      class="@container/permission-group px-3 pt-2 pb-1.5"
    >
      <div class="flex items-center gap-2 pt-0.5 pb-1 text-xs font-medium text-ink-muted">
        <Icon aria-hidden="true" class="size-3.5 shrink-0" />
        {props.block.group.name}
      </div>
      <For each={props.block.actions}>
        {(action) => (
          <PermissionActionRow
            rowKey={targetKey(groupActionTarget(groupId(), action))}
            name={actionName(action)}
            controlLabel={t('agentPermissions.controlLabel', {
              group: props.block.group.name,
              action: actionName(action),
            })}
            state={actionState(action)}
            tools={permission(action)?.tools ?? 0}
            differs={permission(action)?.overrides.length ?? 0}
            sessionLimited={permission(action)?.origin === 'session'}
            disabled={!props.canEdit}
            onChange={(state) => props.onAction(groupId(), action, state)}
          />
        )}
      </For>
      <For each={props.block.tools}>{(tool) => toolRow(tool)}</For>
    </div>
  );
}
