import type {
  AgentToolPermissions,
  PermissionAction,
  ToolPermissionCatalog,
  ToolPermissionChange,
  ToolPermissionRule,
  ToolPermissionState,
} from '@service-agent-harness/generated/schemas';
import type { PolicySource, SourceCandidate } from '../queries/references-view';
import { ACTION_ORDER, targetKey, visibleActions } from './model';

/**
 * Following another agent's permissions, and the new-agent form's draft:
 * pure helpers over the view, its source and the candidates.
 */

/** Keeps each target's last change, in the order targets were first changed. */
export function latestChanges(
  changes: readonly ToolPermissionChange[]
): ToolPermissionChange[] {
  const byTarget = new Map<string, ToolPermissionChange>();
  for (const change of changes) byTarget.set(targetKey(change.target), change);
  return [...byTarget.values()];
}

/** Nothing saved: every action Allow, no exceptions, as an own policy starts. */
export function blankView(
  catalog: ToolPermissionCatalog
): AgentToolPermissions {
  return {
    agentId: '',
    policyId: '',
    kind: 'agent',
    canEdit: true,
    canTighten: true,
    version: catalog.version,
    restricted: 0,
    defaults: ACTION_ORDER.map((action) => ({
      action,
      state: 'always',
      origin: 'default',
    })),
    rules: [],
    groups: catalog.groups
      .filter((group) => group.tools.length > 0)
      .map((group) => ({
        group: group.id,
        actions: visibleActions(group).map((action) => ({
          action,
          state: 'always',
          origin: 'default',
          exception: false,
          tools: group.tools.filter((tool) => tool.action === action).length,
          overrides: [],
        })),
      })),
  };
}

/**
 * The view with `changes` applied as the server applies a person's changes
 * to an own policy: a default (`null` = Allow), an exception (any state;
 * `null` follows the default), or a tool rule. For the new-agent form,
 * whose draft isn't saved until the agent exists.
 */
export function applyChanges(
  view: AgentToolPermissions,
  changes: readonly ToolPermissionChange[]
): AgentToolPermissions {
  const latest = latestChanges(changes);
  const changeFor = (key: string) =>
    latest.find((change) => targetKey(change.target) === key);

  const defaults = view.defaults.map((entry) => {
    const change = changeFor(`action:${entry.action}`);
    if (!change) return entry;
    const state = change.state ?? 'always';
    return {
      ...entry,
      state,
      origin: state === 'always' ? ('default' as const) : ('action' as const),
    };
  });
  const defaultState = (action: PermissionAction): ToolPermissionState =>
    defaults.find((entry) => entry.action === action)?.state ?? 'always';

  const groups = view.groups.map((group) => ({
    ...group,
    actions: group.actions.map((pair) => {
      const change = changeFor(`group_action:${group.group}.${pair.action}`);
      if (change?.state) {
        return {
          ...pair,
          state: change.state,
          origin: 'group_action' as const,
          exception: true,
        };
      }
      // A removed exception, or a pair that had none, follows the default.
      if (change || !pair.exception) {
        return {
          ...pair,
          state: defaultState(pair.action),
          origin: 'action' as const,
          exception: false,
        };
      }
      return pair;
    }),
  }));

  const changed = latest.map((change) => targetKey(change.target));
  const kept = view.rules.filter(
    (rule) => !changed.includes(targetKey(rule.target))
  );
  const added = latest.flatMap((change): ToolPermissionRule[] => {
    const state = change.state;
    if (!state) return [];
    if (change.target.kind === 'action' && state === 'always') return [];
    return [
      {
        target: change.target,
        state,
        viaAgent: false,
        updatedAt: new Date(0).toISOString(),
      },
    ];
  });

  return { ...view, defaults, groups, rules: [...kept, ...added] };
}

/**
 * The policy a new agent follows unless someone picks another: personal
 * Macro for a private agent, the team default for a team agent (when the
 * server lists one).
 */
export function defaultCandidate(
  candidates: readonly SourceCandidate[],
  share: 'Private' | 'Team'
): SourceCandidate | undefined {
  const kind = share === 'Private' ? 'persona' : 'team';
  return candidates.find((candidate) => candidate.kind === kind);
}

/** The name and handle a source or candidate shows. */
export function policyIdentity(policy: Pick<PolicySource, 'agent' | 'team'>): {
  name: string;
  handle?: string;
} {
  if (policy.agent) {
    return { name: policy.agent.name, handle: policy.agent.handle };
  }
  return { name: policy.team?.name ?? '' };
}

/**
 * What a follower shows as its settings: the rules it inherits, and its
 * own restrictions (which also make a group's action an exception).
 */
export function followerRules(view: {
  rules: readonly ToolPermissionRule[];
  inherited?: readonly ToolPermissionRule[] | null;
}): ToolPermissionRule[] {
  return [...(view.inherited ?? []), ...view.rules];
}
