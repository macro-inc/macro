import type {
  AgentToolPermissions,
  PermissionAction,
  ToolPermissionAction,
  ToolPermissionCatalog,
  ToolPermissionCatalogGroup,
  ToolPermissionCatalogTool,
  ToolPermissionChange,
  ToolPermissionGroup,
  ToolPermissionRule,
  ToolPermissionState,
  ToolPermissionTarget,
} from '@service-agent-harness/generated/schemas';

/**
 * The permissions' pure logic. The server resolves every state; this only
 * picks out what the settings show (visible pairs, exceptions, counts) and
 * builds the changes they send.
 */

/** Actions in display order: Read, Create, Edit, Send, Delete. */
export const ACTION_ORDER: readonly PermissionAction[] = [
  'read',
  'create',
  'update',
  'send',
  'destroy',
];

/** A tool, as the catalog and the overrides both name it. */
export type ToolRef = { service: string; operation: string };

/** A row to open, scroll to and focus, e.g. from a link in chat. */
export type PermissionFocus = {
  group: string;
  action?: PermissionAction;
  tool?: ToolRef;
};

/** A stable string for a target, for pending state and lookups. */
export function targetKey(target: ToolPermissionTarget): string {
  if (target.kind === 'tool')
    return `tool:${target.service}.${target.operation}`;
  if (target.kind === 'action') return `action:${target.action}`;
  return `group_action:${target.group}.${target.action}`;
}

export function toolTarget(tool: ToolRef): ToolPermissionTarget {
  return { kind: 'tool', service: tool.service, operation: tool.operation };
}

export function groupActionTarget(
  group: string,
  action: PermissionAction
): ToolPermissionTarget {
  return { kind: 'group_action', group, action };
}

export function actionTarget(action: PermissionAction): ToolPermissionTarget {
  return { kind: 'action', action };
}

function sameTool(a: ToolRef, b: ToolRef): boolean {
  return a.service === b.service && a.operation === b.operation;
}

export function toolKey(tool: ToolRef): string {
  return `${tool.service}.${tool.operation}`;
}

/** The tool's override in its action, when its state differs from the action's. */
export function toolOverride(action: ToolPermissionAction, tool: ToolRef) {
  return action.overrides.find((override) => sameTool(override, tool));
}

/** The saved rule for a target, if there is one. */
export function ruleFor(
  rules: readonly ToolPermissionRule[],
  target: ToolPermissionTarget
): ToolPermissionRule | undefined {
  const key = targetKey(target);
  return rules.find((rule) => targetKey(rule.target) === key);
}

/**
 * The change that sets a tool to `state`, given the state its action is
 * saved in (once the action's own change, if any, has saved). Setting it to
 * that state clears its own rule (`null`), so a saved tool rule always means
 * "differs".
 */
export function changeForTool(
  actionState: ToolPermissionState,
  tool: ToolRef,
  state: ToolPermissionState
): ToolPermissionChange {
  return {
    target: toolTarget(tool),
    state: state === actionState ? null : state,
  };
}

/**
 * The change a chat card's control makes to a group's action: setting it to
 * the action's default follows the default (`null`); any other state saves
 * an exception. The settings' own exception menus keep an explicit choice
 * instead (`changeForException`).
 */
export function changeForAction(
  group: string,
  action: PermissionAction,
  state: ToolPermissionState,
  defaultState: ToolPermissionState
): ToolPermissionChange {
  return {
    target: groupActionTarget(group, action),
    state: state === defaultState ? null : state,
  };
}

/** The view's permissions for one group, if the view lists it. */
export function groupPermissions(
  view: AgentToolPermissions,
  group: string
): ToolPermissionGroup | undefined {
  return view.groups.find((entry) => entry.group === group);
}

export function actionPermission(
  group: ToolPermissionGroup | undefined,
  action: PermissionAction
): ToolPermissionAction | undefined {
  return group?.actions.find((entry) => entry.action === action);
}

/** The catalog's tools for one action of a group, in catalog order. */
function actionTools(
  catalogGroup: ToolPermissionCatalogGroup,
  action: PermissionAction
): ToolPermissionCatalogTool[] {
  return catalogGroup.tools.filter((tool) => tool.action === action);
}

/** Whether the group has a tool for `action`. */
export function hasTools(
  catalogGroup: ToolPermissionCatalogGroup,
  action: PermissionAction
): boolean {
  return catalogGroup.tools.some((tool) => tool.action === action);
}

/** The actions the group has tools for, in display order. */
export function visibleActions(
  catalogGroup: ToolPermissionCatalogGroup
): PermissionAction[] {
  return ACTION_ORDER.filter((action) => hasTools(catalogGroup, action));
}

// Action defaults and entity exceptions. A pair (entity type × action) is
// visible when at least one catalog tool maps to it; rules on hidden pairs
// stay saved and enforced but are never shown or counted.

export type EntityPair = { group: string; action: PermissionAction };

/** Every (entity, action) pair with at least one tool, in catalog then display order. */
export function visiblePairs(catalog: ToolPermissionCatalog): EntityPair[] {
  return catalog.groups.flatMap((group) =>
    visibleActions(group).map((action) => ({ group: group.id, action }))
  );
}

/** The entities (catalog groups) that have tools for `action`, in catalog order. */
export function entitiesFor(
  catalog: ToolPermissionCatalog,
  action: PermissionAction
): ToolPermissionCatalogGroup[] {
  return catalog.groups.filter((group) => hasTools(group, action));
}

/** The action's default; no saved default is Allow. */
export function defaultFor(
  view: AgentToolPermissions,
  action: PermissionAction
): ToolPermissionState {
  return (
    view.defaults.find((entry) => entry.action === action)?.state ?? 'always'
  );
}

export type Exception = {
  group: ToolPermissionCatalogGroup;
  state: ToolPermissionState;
};

/** A control's state while its change saves, if one is saving. */
export type PendingLookup = (
  target: ToolPermissionTarget
) => ToolPermissionState | undefined;

const NOTHING_PENDING: PendingLookup = () => undefined;

/**
 * The action's visible exceptions, in catalog order: the saved ones, and
 * ones being added, each in the state it shows (`pending` while saving).
 */
export function exceptionsFor(
  catalog: ToolPermissionCatalog,
  view: AgentToolPermissions,
  action: PermissionAction,
  pending: PendingLookup = NOTHING_PENDING
): Exception[] {
  return entitiesFor(catalog, action).flatMap((group) => {
    const saving = pending(groupActionTarget(group.id, action));
    if (saving !== undefined) return [{ group, state: saving }];
    const pair = actionPermission(groupPermissions(view, group.id), action);
    if (!pair?.exception) return [];
    return [{ group, state: pair.state }];
  });
}

/** How many entities with tools for `action` follow its default. */
export function followingCount(
  catalog: ToolPermissionCatalog,
  action: PermissionAction,
  exceptions: readonly Exception[]
): number {
  return entitiesFor(catalog, action).length - exceptions.length;
}

/** The entities an exception can be added for: tools for the action, no exception yet. */
export function addableEntities(
  catalog: ToolPermissionCatalog,
  action: PermissionAction,
  exceptions: readonly Exception[]
): ToolPermissionCatalogGroup[] {
  const taken = exceptions.map((entry) => entry.group.id);
  return entitiesFor(catalog, action).filter(
    (group) => !taken.includes(group.id)
  );
}

export type ToolSetting = {
  tool: ToolPermissionCatalogTool;
  group: ToolPermissionCatalogGroup;
  rule: ToolPermissionRule;
};

/** Saved rules on individual tools of `action`, for catalog tools only. */
export function toolSettingsFor(
  catalog: ToolPermissionCatalog,
  view: AgentToolPermissions,
  action: PermissionAction
): ToolSetting[] {
  return catalog.groups.flatMap((group) =>
    actionTools(group, action).flatMap((tool) => {
      const rule = ruleFor(view.rules, toolTarget(tool));
      return rule ? [{ tool, group, rule }] : [];
    })
  );
}

/** Sets an action's default. Allow clears it, since no default is Allow. */
export function changeForDefault(
  action: PermissionAction,
  state: ToolPermissionState
): ToolPermissionChange {
  return {
    target: actionTarget(action),
    state: state === 'always' ? null : state,
  };
}

/**
 * Sets an entity's exception for an action; `null` removes it, so the
 * entity follows the default. An exception equal to the default is kept.
 */
export function changeForException(
  group: string,
  action: PermissionAction,
  state: ToolPermissionState | null
): ToolPermissionChange {
  return { target: groupActionTarget(group, action), state };
}

/** Whether a rule is shown: defaults always, an exception on a visible pair, a tool in the catalog. */
function ruleVisible(
  catalog: ToolPermissionCatalog,
  rule: ToolPermissionRule
): boolean {
  const target = rule.target;
  if (target.kind === 'action') return true;
  if (target.kind === 'group_action') {
    return entitiesFor(catalog, target.action).some(
      (group) => group.id === target.group
    );
  }
  return catalog.groups.some((group) =>
    group.tools.some((tool) => sameTool(tool, target))
  );
}

/** Visible saved settings, for the "N settings changed" line. */
export function settingCounts(
  catalog: ToolPermissionCatalog,
  rules: readonly ToolPermissionRule[]
) {
  const visible = rules.filter((rule) => ruleVisible(catalog, rule));
  return {
    total: visible.length,
    /** Set by a person, not by the agent restricting itself. */
    byPerson: visible.filter((rule) => !rule.viaAgent).length,
    byAgent: visible.filter((rule) => rule.viaAgent).length,
  };
}

/** The action a focus points at: its own, or its tool's. */
export function focusedAction(
  catalog: ToolPermissionCatalog,
  focus: PermissionFocus
): PermissionAction | undefined {
  if (focus.action) return focus.action;
  const tool = focus.tool;
  if (!tool) return undefined;
  return catalog.groups
    .flatMap((group) => group.tools)
    .find((candidate) => sameTool(candidate, tool))?.action;
}
