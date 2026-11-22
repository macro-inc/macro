import { formatLocale, t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import type {
  AgentToolPermissions,
  PermissionAction,
  ToolPermissionCatalog,
  ToolPermissionCatalogGroup,
  ToolPermissionCatalogTool,
  ToolPermissionChange,
  ToolPermissionState,
  ToolPermissionTarget,
} from '@service-agent-harness/generated/schemas';
import {
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { createStore } from 'solid-js/store';
import { stateLabel } from '../components/labels';
import { MatchText } from '../components/match-text';
import { PermissionActionRow } from '../components/permission-action-row';
import { PermissionGroupRow } from '../components/permission-group-row';
import { PermissionGroupSummary } from '../components/permission-group-summary';
import {
  PermissionToolList,
  PermissionToolSection,
  ShowMoreTools,
  type ToolFilter,
} from '../components/permission-tool-list';
import {
  PermissionToolRow,
  type ToolRowStatus,
} from '../components/permission-tool-row';
import { PermissionsNoMatch } from '../components/permissions-notes';
import {
  ACTION_ORDER,
  actionPermission,
  changeForAction,
  type GroupMatch,
  groupActionTarget,
  groupPermissions,
  groupSummary,
  type PermissionSearch,
  ruleFor,
  searchPermissions,
  type ToolRef,
  targetKey,
  toolKey,
  toolOverride,
  toolTarget,
} from '../core/model';
import type { PendingChanges } from '../primitives/pending-changes';

/** A row to open, scroll to and focus, e.g. from a link in chat. */
export type PermissionFocus = {
  group: string;
  action?: PermissionAction;
  tool?: ToolRef;
};

/** "All" lists this many of a group's tools before Show more. */
const TOOL_PAGE = 50;

const FLASH_MS = 1200;

type ToolSection = {
  action: PermissionAction;
  tools: ToolPermissionCatalogTool[];
};

/**
 * Every catalog group as a collapsible row: five action controls and the
 * group's individual tools. Owns expansion, the tool filter and paging;
 * saving goes through `changes`.
 */
export function AgentPermissionsList(props: {
  agentName: string;
  catalog: ToolPermissionCatalog;
  view: AgentToolPermissions;
  canEdit: boolean;
  changes: PendingChanges;
  /** The search, already debounced; empty when not searching. */
  query: string;
  onClearSearch: () => void;
  focus?: PermissionFocus;
}) {
  let container: HTMLDivElement | undefined;
  const [ui, setUi] = createStore<{
    expanded: string[];
    filters: Record<string, ToolFilter>;
    limits: Record<string, number>;
  }>({
    expanded: props.focus ? [props.focus.group] : [],
    filters: props.focus?.tool ? { [props.focus.group]: 'all' } : {},
    // A linked tool may sit past the first page of its group.
    limits: props.focus?.tool
      ? { [props.focus.group]: Number.MAX_SAFE_INTEGER }
      : {},
  });
  const [flashKey, setFlashKey] = createSignal<string>();

  const searching = () => props.query.trim().length > 0;
  const search = createMemo((): PermissionSearch | undefined =>
    searching() ? searchPermissions(props.catalog, props.query) : undefined
  );
  const groupMatch = (groupId: string): GroupMatch | undefined =>
    search()?.groups[groupId];
  // A search narrows a group unless the group's own name matched.
  const narrowed = (groupId: string) => {
    const match = groupMatch(groupId);
    return match !== undefined && !match.all;
  };

  const visibleGroups = () => {
    const current = search();
    if (!current) return props.catalog.groups;
    return props.catalog.groups.filter((group) => current.groups[group.id]);
  };

  const isOpen = (groupId: string) =>
    searching() || ui.expanded.includes(groupId);

  const toggle = (groupId: string) => {
    if (searching()) return;
    setUi('expanded', (expanded) =>
      expanded.includes(groupId)
        ? expanded.filter((id) => id !== groupId)
        : [...expanded, groupId]
    );
  };

  const actionName = (action: PermissionAction) =>
    props.catalog.actions.find((entry) => entry.action === action)?.name ??
    action;

  const permission = (groupId: string, action: PermissionAction) =>
    actionPermission(groupPermissions(props.view, groupId), action);

  const shownActionState = (groupId: string, action: PermissionAction) =>
    props.changes.pendingState(targetKey(groupActionTarget(groupId, action))) ??
    permission(groupId, action)?.state ??
    'always';

  const differs = (groupId: string) =>
    groupPermissions(props.view, groupId)?.actions.reduce(
      (count, action) => count + action.overrides.length,
      0
    ) ?? 0;

  const filter = (groupId: string): ToolFilter =>
    ui.filters[groupId] ?? (differs(groupId) > 0 ? 'differs' : 'all');

  const visibleActions = (groupId: string) => {
    const match = groupMatch(groupId);
    if (!match || match.all) return ACTION_ORDER;
    return ACTION_ORDER.filter((action) => match.actions.includes(action));
  };

  // The tools listed under "Individual tools", per action, plus how many
  // more Show more would add.
  const computeToolSections = (
    group: ToolPermissionCatalogGroup
  ): { sections: ToolSection[]; hidden: number } => {
    const match = groupMatch(group.id);
    let tools = group.tools;

    if (match && !match.all) {
      tools = tools.filter((tool) => match.tools.includes(toolKey(tool)));
    } else if (filter(group.id) === 'differs') {
      tools = tools.filter((tool) => {
        const action = permission(group.id, tool.action);
        return action !== undefined && toolOverride(action, tool) !== undefined;
      });
    }

    const ordered = ACTION_ORDER.flatMap((action) =>
      tools.filter((tool) => tool.action === action)
    );
    const capped =
      match && !match.all
        ? ordered
        : ordered.slice(0, ui.limits[group.id] ?? TOOL_PAGE);

    return {
      sections: ACTION_ORDER.map((action) => ({
        action,
        tools: capped.filter((tool) => tool.action === action),
      })).filter((section) => section.tools.length > 0),
      hidden: ordered.length - capped.length,
    };
  };

  // Computed once per change of the view, search or filters, not per read.
  const sectionsByGroup = createMemo(() =>
    Object.fromEntries(
      visibleGroups().map((group) => [group.id, computeToolSections(group)])
    )
  );
  const toolSections = (group: ToolPermissionCatalogGroup) =>
    sectionsByGroup()[group.id] ?? computeToolSections(group);

  const agentHint = (groupId: string, action: PermissionAction) => {
    const rule = ruleFor(props.view.rules, groupActionTarget(groupId, action));
    if (!rule?.viaAgent) return undefined;
    const date = new Intl.DateTimeFormat(formatLocale(), {
      dateStyle: 'medium',
    }).format(new Date(rule.updatedAt));
    return t('agentPermissions.setByAgentHint', {
      agent: props.agentName,
      date,
    });
  };

  // `apply` reports its own failures, so the clicks don't wait on it.
  const apply = (
    target: ToolPermissionTarget,
    shown: ToolPermissionState,
    change: ToolPermissionChange
  ) =>
    fireAndForget(
      props.changes.apply(target, shown, change),
      'agent-permissions'
    );

  const setAction = (
    groupId: string,
    action: PermissionAction,
    state: ToolPermissionState
  ) =>
    apply(
      groupActionTarget(groupId, action),
      state,
      changeForAction(groupId, action, state)
    );

  const setTool = (
    group: ToolPermissionCatalogGroup,
    tool: ToolPermissionCatalogTool,
    state: ToolPermissionState
  ) =>
    fireAndForget(
      props.changes.setTool(
        groupActionTarget(group.id, tool.action),
        permission(group.id, tool.action)?.state ?? 'always',
        tool,
        state
      ),
      'agent-permissions'
    );

  const clearTool = (
    group: ToolPermissionCatalogGroup,
    tool: ToolPermissionCatalogTool
  ) =>
    apply(toolTarget(tool), shownActionState(group.id, tool.action), {
      target: toolTarget(tool),
      state: null,
    });

  const toolActions = (group: ToolPermissionCatalogGroup) =>
    toolSections(group).sections.map((section) => section.action);

  const sectionTools = (
    group: ToolPermissionCatalogGroup,
    action: PermissionAction
  ) =>
    toolSections(group).sections.find((section) => section.action === action)
      ?.tools ?? [];

  const toolRow = (
    group: ToolPermissionCatalogGroup,
    tool: ToolPermissionCatalogTool
  ) => {
    const action = () => permission(group.id, tool.action);
    const key = targetKey(toolTarget(tool));
    const rule = () => ruleFor(props.view.rules, toolTarget(tool));

    const status = (): ToolRowStatus => {
      const current = action();
      if (current && toolOverride(current, tool)) {
        return {
          kind: 'differs',
          action: actionName(tool.action),
          actionState: stateLabel(current.state),
        };
      }
      if (rule()) return { kind: 'own' };
      return { kind: 'follows', action: actionName(tool.action) };
    };

    // While its own change saves, the chosen state; else its override, else
    // its action's (which may itself be saving).
    const shown = () => {
      const pending = props.changes.pendingState(key);
      if (pending) return pending;
      const current = action();
      const override = current && toolOverride(current, tool);
      if (override) return override.state;
      return shownActionState(group.id, tool.action);
    };

    return (
      <PermissionToolRow
        rowKey={key}
        flash={flashKey() === key}
        label={<MatchText text={tool.label} query={props.query} />}
        operation={<MatchText text={toolKey(tool)} query={props.query} />}
        controlLabel={tool.label}
        state={shown()}
        status={status()}
        byAgent={rule()?.viaAgent}
        clearLabel={t('agentPermissions.useActionSetting', {
          action: actionName(tool.action),
        })}
        onClear={
          rule() && props.canEdit ? () => clearTool(group, tool) : undefined
        }
        disabled={!props.canEdit || !action()}
        onChange={(state) => setTool(group, tool, state)}
      />
    );
  };

  // A deep link opens its group (in the initial store), then scrolls to its
  // row, flashes it and moves focus to its control.
  onMount(() => {
    const focus = props.focus;
    if (!focus) return;
    const key = focus.tool
      ? targetKey(toolTarget(focus.tool))
      : focus.action
        ? targetKey(groupActionTarget(focus.group, focus.action))
        : undefined;
    const row = key
      ? container?.querySelector<HTMLElement>(
          `[data-permission-row="${CSS.escape(key)}"]`
        )
      : container?.querySelector<HTMLElement>(
          `[data-permission-group="${CSS.escape(focus.group)}"]`
        );
    if (!row) return;
    row.scrollIntoView({ block: 'center' });
    row
      .querySelector<HTMLElement>('input:checked, button, input')
      ?.focus({ preventScroll: true });
    if (!key) return;
    setFlashKey(key);
    const timer = setTimeout(() => setFlashKey(undefined), FLASH_MS);
    onCleanup(() => clearTimeout(timer));
  });

  return (
    <div ref={container} class="contents">
      <Show
        when={visibleGroups().length > 0}
        fallback={
          <PermissionsNoMatch
            query={props.query.trim()}
            onClear={props.onClearSearch}
          />
        }
      >
        <For each={visibleGroups()}>
          {(group) => (
            <PermissionGroupRow
              groupId={group.id}
              open={isOpen(group.id)}
              onToggle={() => toggle(group.id)}
              name={<MatchText text={group.name} query={props.query} />}
              summary={
                <PermissionGroupSummary
                  summary={groupSummary(
                    group,
                    groupPermissions(props.view, group.id),
                    props.view.rules
                  )}
                />
              }
            >
              <div class="flex flex-col divide-y divide-edge-divider @min-[460px]/permission-group:divide-y-0">
                <For each={visibleActions(group.id)}>
                  {(action) => (
                    <PermissionActionRow
                      rowKey={targetKey(groupActionTarget(group.id, action))}
                      flash={
                        flashKey() ===
                        targetKey(groupActionTarget(group.id, action))
                      }
                      name={
                        <MatchText
                          text={actionName(action)}
                          query={props.query}
                        />
                      }
                      controlLabel={t('agentPermissions.controlLabel', {
                        group: group.name,
                        action: actionName(action),
                      })}
                      state={shownActionState(group.id, action)}
                      tools={permission(group.id, action)?.tools ?? 0}
                      differs={
                        permission(group.id, action)?.overrides.length ?? 0
                      }
                      agentHint={agentHint(group.id, action)}
                      disabled={!props.canEdit}
                      onChange={(state) => setAction(group.id, action, state)}
                    />
                  )}
                </For>
              </div>
              <Show
                when={
                  group.tools.length > 0 &&
                  (!narrowed(group.id) ||
                    (groupMatch(group.id)?.tools.length ?? 0) > 0)
                }
              >
                <PermissionToolList
                  total={group.tools.length}
                  differs={differs(group.id)}
                  filter={narrowed(group.id) ? undefined : filter(group.id)}
                  onFilterChange={(next) => setUi('filters', group.id, next)}
                >
                  {/* Keyed by action and by catalog tool, which stay the
                      same objects across saves, so rows (and focus) survive
                      the view being replaced. */}
                  <For each={toolActions(group)}>
                    {(action) => (
                      <PermissionToolSection action={actionName(action)}>
                        <For each={sectionTools(group, action)}>
                          {(tool) => toolRow(group, tool)}
                        </For>
                      </PermissionToolSection>
                    )}
                  </For>
                  <Show when={toolSections(group).hidden > 0}>
                    <ShowMoreTools
                      count={toolSections(group).hidden}
                      onClick={() =>
                        setUi('limits', group.id, group.tools.length)
                      }
                    />
                  </Show>
                </PermissionToolList>
              </Show>
            </PermissionGroupRow>
          )}
        </For>
      </Show>
    </div>
  );
}
