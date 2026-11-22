import type {
  AgentToolPermissions,
  PermissionAction,
  ToolPermissionAction,
  ToolPermissionOrigin,
  ToolPermissionRule,
  ToolPermissionState,
  ToolPermissionTarget,
} from '@service-agent-harness/generated/schemas';

/*
 * The permissions view and changes with action defaults and entity
 * exceptions: `defaults`, `groups[].actions[].exception`, the `action`
 * target and the `action` / `source` origins.
 *
 * TODO(agent-permissions defaults): the backend half adds these to the
 * agent harness's OpenAPI. Once the generated client has them, replace each
 * type here with its generated one (`AgentToolPermissions`,
 * `ToolPermissionTarget`, `ToolPermissionChange`, `ToolPermissionRule`,
 * `ToolPermissionOrigin`), drop `PermissionsWireView` and
 * `normalizePermissionsView`, and remove the type parameters on
 * `toolPermissionsClient`. Nothing else in the feature names the wire types.
 */

/** Where a resolved state came from. */
type PermissionOrigin = ToolPermissionOrigin | 'action' | 'source';

/** An action's default for every entity without an exception. */
type ActionTarget = { kind: 'action'; action: PermissionAction };

export type PermissionTarget = ToolPermissionTarget | ActionTarget;

export type PermissionRule = Omit<ToolPermissionRule, 'target'> & {
  target: PermissionTarget;
};

/** `null` deletes the target's rule: a default goes back to Allow, an exception or tool follows what's above it. */
export type PermissionChange = {
  target: PermissionTarget;
  state: ToolPermissionState | null;
};

export type ActionDefault = {
  action: PermissionAction;
  state: ToolPermissionState;
  origin: PermissionOrigin;
};

/** One entity type's action: its state, tools and overrides. */
export type PermissionPair = Omit<ToolPermissionAction, 'origin'> & {
  origin: PermissionOrigin;
  /** This policy has an exception row for the pair. */
  exception: boolean;
};

export type PermissionGroup = { group: string; actions: PermissionPair[] };

export type PermissionsView = Omit<
  AgentToolPermissions,
  'groups' | 'rules' | 'sessionRules'
> & {
  /** The five action defaults, in display order. */
  defaults: ActionDefault[];
  groups: PermissionGroup[];
  /** The policy's own rows, hidden pairs included. */
  rules: PermissionRule[];
  sessionRules?: PermissionRule[] | null;
};

/** What the server answers; a server without defaults leaves them out. */
export type PermissionsWireView = Omit<
  PermissionsView,
  'defaults' | 'groups'
> & {
  defaults?: ActionDefault[];
  groups: {
    group: string;
    actions: (Omit<PermissionPair, 'exception'> & { exception?: boolean })[];
  }[];
};

const ACTIONS: readonly PermissionAction[] = [
  'read',
  'create',
  'update',
  'send',
  'destroy',
];

/**
 * Fills in what an older server leaves out: no saved default is Allow, and
 * an exception is a saved rule on the pair.
 */
export function normalizePermissionsView(
  view: PermissionsWireView
): PermissionsView {
  const saved = (group: string, action: PermissionAction) =>
    view.rules.some(
      (rule) =>
        rule.target.kind === 'group_action' &&
        rule.target.group === group &&
        rule.target.action === action
    );

  return {
    ...view,
    defaults:
      view.defaults ??
      ACTIONS.map((action) => ({
        action,
        state: 'always',
        origin: 'default',
      })),
    groups: view.groups.map((group) => ({
      group: group.group,
      actions: group.actions.map((pair) => ({
        ...pair,
        exception: pair.exception ?? saved(group.group, pair.action),
      })),
    })),
  };
}
