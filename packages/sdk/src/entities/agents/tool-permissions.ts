/**
 * An agent's tool permissions.
 *
 * @flag enable-agent-permissions
 * @module
 */
import type {
  AgentToolPermissions,
  ToolPermissionAppliedTo,
  ToolPermissionChange,
} from '../../../generated/agent-harness/types.gen';
import type { Agent } from './agent';

export type {
  PermissionAction,
  ToolPermissionCatalog,
  ToolPermissionChange,
  ToolPermissionDefault,
  ToolPermissionGroup,
  ToolPermissionRule,
  ToolPermissionState,
  ToolPermissionTarget,
} from '../../../generated/agent-harness/types.gen';

/**
 * Which Macro SDK operations an agent's code may call: `always`, `ask` (only
 * after a person approves), or `never`. Each operation belongs to a group
 * (Documents, Email, ...) and has an action (create, read, update, destroy,
 * send). Each action has a default (`defaults`, `always` unless set), which
 * every group follows unless it has an exception for that action (any state,
 * kept even when it equals the default; `exception` on the group's action).
 * An operation's state is its own setting, else its group's action. A
 * setting the agent made only adds to what it sits under: it takes the
 * stricter of the two. Permissions apply to JS tools `ExecuteCode` programs.
 */
export type ToolPermissions = Omit<AgentToolPermissions, 'agentId'> & {
  /** The agent (or built-in persona) the permissions belong to. */
  agent: Agent;
};

/** The result of {@link Agent.tightenToolPermissions}. */
export type TightenedToolPermissions = {
  /**
   * `agent`: saved to the agent. `session`: the person the agent acts for
   * may not edit it, so the restriction holds for this session only.
   */
  appliedTo: ToolPermissionAppliedTo;
  /** The permissions now. */
  permissions: ToolPermissions;
};

/** The changes {@link Agent.tightenToolPermissions} applies together. */
export type ToolPermissionChanges = ToolPermissionChange[];

/** A wire view, with its agent as a handle. */
export function toolPermissions(
  agent: Agent,
  view: AgentToolPermissions,
): ToolPermissions {
  const { agentId: _agentId, ...rest } = view;
  return { ...rest, agent };
}
