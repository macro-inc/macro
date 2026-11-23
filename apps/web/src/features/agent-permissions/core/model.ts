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
 * The permissions page's pure logic. The server resolves every state; the only
 * resolution done here is a tool's state inside its group's custom view: its
 * override when it has one, else its action's state.
 */

export const ACTION_ORDER: readonly PermissionAction[] = [
  'create',
  'read',
  'update',
  'destroy',
  'send',
];

/** A tool, as the catalog and the overrides both name it. */
export type ToolRef = { service: string; operation: string };

/** A stable string for a target, for pending state and lookups. */
export function targetKey(target: ToolPermissionTarget): string {
  if (target.kind === 'tool')
    return `tool:${target.service}.${target.operation}`;
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

function sameTool(a: ToolRef, b: ToolRef): boolean {
  return a.service === b.service && a.operation === b.operation;
}

/** The tool's override in its action, when its state differs from the action's. */
export function toolOverride(action: ToolPermissionAction, tool: ToolRef) {
  return action.overrides.find((override) => sameTool(override, tool));
}

/** A tool's state in its group's custom view. */
export function toolState(
  action: ToolPermissionAction,
  tool: ToolRef
): ToolPermissionState {
  return toolOverride(action, tool)?.state ?? action.state;
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
 * saved in (once the action's own change, if any, has saved). Setting it to that state
 * clears its own rule (`null`), so a saved tool rule always means "differs".
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
 * The change that sets a group's action. The server treats Always allow as
 * clearing the rule, since it is the default.
 */
export function changeForAction(
  group: string,
  action: PermissionAction,
  state: ToolPermissionState
): ToolPermissionChange {
  return { target: groupActionTarget(group, action), state };
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

export type GroupSummary = {
  toolCount: number;
  /**
   * The state every action the group has tools for is in, when they all
   * agree ("Asks for everything").
   */
  everything?: ToolPermissionState;
  asks: PermissionAction[];
  nevers: PermissionAction[];
  /** Tools in the group with their own saved rule. */
  customTools: number;
  /** Any rule in the group the agent set on itself. */
  byAgent: boolean;
  /** Any action limited for the current session only. */
  sessionLimited: boolean;
};

function ruleGroup(
  rule: ToolPermissionRule,
  catalogGroup: ToolPermissionCatalogGroup
): boolean {
  const target = rule.target;
  if (target.kind === 'group_action') return target.group === catalogGroup.id;
  return catalogGroup.tools.some((tool) => sameTool(tool, target));
}

/** What a collapsed group row says about the group. */
export function groupSummary(
  catalogGroup: ToolPermissionCatalogGroup,
  group: ToolPermissionGroup | undefined,
  rules: readonly ToolPermissionRule[]
): GroupSummary {
  const actions = ACTION_ORDER.flatMap((action) => {
    const permission = actionPermission(group, action);
    return permission ? [permission] : [];
  });
  const groupRules = rules.filter((rule) => ruleGroup(rule, catalogGroup));
  // Only the actions the group has tools for: an action with none can't
  // make the agent do anything.
  const used = actions.filter((permission) =>
    catalogGroup.tools.some((tool) => tool.action === permission.action)
  );
  const states = new Set(used.map((permission) => permission.state));
  const [agreed] = states;

  return {
    toolCount: catalogGroup.tools.length,
    ...(states.size === 1 && agreed ? { everything: agreed } : {}),
    asks: actions
      .filter((permission) => permission.state === 'ask')
      .map((permission) => permission.action),
    nevers: actions
      .filter((permission) => permission.state === 'never')
      .map((permission) => permission.action),
    customTools: groupRules.filter((rule) => rule.target.kind === 'tool')
      .length,
    byAgent: groupRules.some((rule) => rule.viaAgent),
    sessionLimited: actions.some(
      (permission) =>
        permission.origin === 'session' ||
        permission.overrides.some((override) => override.origin === 'session')
    ),
  };
}

/** Saved settings, the ones Reset puts back to Always allow. */
export function settingCounts(rules: readonly ToolPermissionRule[]) {
  return {
    total: rules.length,
    /** Set by a person, not by the agent restricting itself. */
    byPerson: rules.filter((rule) => !rule.viaAgent).length,
    byAgent: rules.filter((rule) => rule.viaAgent).length,
    tools: rules.filter((rule) => rule.target.kind === 'tool').length,
  };
}

/** One group-and-action that isn't Always allow, for the editor's summary. */
export type Restriction = {
  group: string;
  action: PermissionAction;
  state: Exclude<ToolPermissionState, 'always'>;
};

/** Every restricted group action, in catalog then action order. */
export function restrictions(
  catalog: ToolPermissionCatalog,
  view: AgentToolPermissions
): Restriction[] {
  return catalog.groups.flatMap((catalogGroup) => {
    const group = groupPermissions(view, catalogGroup.id);
    return ACTION_ORDER.flatMap((action): Restriction[] => {
      const state = actionPermission(group, action)?.state;
      if (state === undefined || state === 'always') return [];
      return [{ group: catalogGroup.id, action, state }];
    });
  });
}

/** Restricted group actions plus individual tools restricted on their own. */
export function restrictionCount(view: AgentToolPermissions): number {
  return view.groups.reduce(
    (count, group) =>
      count +
      group.actions.reduce(
        (actionCount, action) =>
          actionCount +
          (action.state === 'always' ? 0 : 1) +
          // A tool allowed under a stricter action loosens, not restricts.
          action.overrides.filter((override) => override.state !== 'always')
            .length,
        0
      ),
    0
  );
}

/** The catalog's tools for one action of a group, in catalog order. */
export function actionTools(
  catalogGroup: ToolPermissionCatalogGroup,
  action: PermissionAction
): ToolPermissionCatalogTool[] {
  return catalogGroup.tools.filter((tool) => tool.action === action);
}

export function toolKey(tool: ToolRef): string {
  return `${tool.service}.${tool.operation}`;
}

/** What a search shows of one group. */
export type GroupMatch = {
  /** The group's name matched: show it whole. */
  all: boolean;
  actions: PermissionAction[];
  /** `toolKey`s of matching tools. */
  tools: string[];
};

export type PermissionSearch = {
  groups: Record<string, GroupMatch>;
  groupCount: number;
  toolCount: number;
};

/**
 * Case-insensitive substring search over group names, action names, tool
 * labels and `service.operation`. Only matching groups are listed. A group
 * whose name matched shows everything; otherwise it shows the matching
 * actions and tools.
 */
export function searchPermissions(
  catalog: ToolPermissionCatalog,
  query: string
): PermissionSearch {
  const needle = query.trim().toLocaleLowerCase();
  const matches = (text: string) => text.toLocaleLowerCase().includes(needle);
  const actionNames = new Map(
    catalog.actions.map((action) => [action.action, action.name])
  );

  const groups: Record<string, GroupMatch> = {};
  let toolCount = 0;

  for (const group of catalog.groups) {
    if (matches(group.name)) {
      groups[group.id] = { all: true, actions: [], tools: [] };
      toolCount += group.tools.length;
      continue;
    }

    // An action name ("Send") matches only where the group has tools for
    // it, or every group would match every action.
    const actions = ACTION_ORDER.filter(
      (action) =>
        matches(actionNames.get(action) ?? action) &&
        group.tools.some((tool) => tool.action === action)
    );
    const tools = group.tools
      .filter((tool) => matches(tool.label) || matches(toolKey(tool)))
      .map(toolKey);
    if (actions.length === 0 && tools.length === 0) continue;

    groups[group.id] = { all: false, actions, tools };
    toolCount += tools.length;
  }

  return { groups, groupCount: Object.keys(groups).length, toolCount };
}

/** Where `query` occurs in `text`, for highlighting. */
export function matchRange(
  text: string,
  query: string
): { start: number; end: number } | undefined {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return undefined;
  const start = text.toLocaleLowerCase().indexOf(needle);
  if (start < 0) return undefined;
  return { start, end: start + needle.length };
}
