import type {
  AgentToolPermissions,
  ToolPermissionRule,
} from '@service-agent-harness/generated/schemas';

/*
 * Live references between policies: an agent following another policy (its
 * source), the source's identity in the view, what it inherits, and the
 * candidates it may follow (design section 5).
 *
 * TODO(agent-permissions references): the backend's OpenAPI adds these to
 * the generated client. Once it does, replace each type here with its
 * generated one, delete this file, and drop the type parameters on
 * `toolPermissionsClient` (`get`, `setSource`, `detach`, `sources`,
 * `policy`).
 */

/** Whose policy a source is. */
export type PolicyKind = 'agent' | 'persona' | 'team';

export type PolicyAgent = {
  id: string;
  name: string;
  handle: string;
  avatarUrl?: string | null;
  deleted: boolean;
};

export type PolicyTeam = { id: string; name: string };

/** Who a policy belongs to: one person, or a team. */
export type PolicyScope =
  | { kind: 'personal' }
  | { kind: 'team'; teamId: string; teamName: string };

/** The policy an agent follows. */
export type PolicySource = {
  /** `null` once the source was deleted for good (`lost`). */
  policyId: string | null;
  kind: PolicyKind;
  agent?: PolicyAgent | null;
  team?: PolicyTeam | null;
  scope: PolicyScope;
  /** `deleted`: frozen as it was; `lost`: gone, so everything asks. */
  status: 'live' | 'deleted' | 'lost';
  /** The source is still one this agent may follow. */
  inScope: boolean;
  /** The caller may edit the source itself. */
  canEdit: boolean;
  /** The rest of the chain, for "Scout follows Macro". */
  via: { name: string; handle: string }[];
};

/** An agent's permissions, with what it follows. */
export type ReferencesView = AgentToolPermissions & {
  /** The caller may set or clear the agent's source. */
  canSetSource?: boolean;
  source?: PolicySource | null;
  /** What following resolves to without the agent's own rows. */
  inherited?: ToolPermissionRule[] | null;
};

/** A policy the agent may follow. */
export type SourceCandidate = {
  policyId: string;
  kind: PolicyKind;
  agent?: PolicyAgent | null;
  team?: PolicyTeam | null;
  scope: PolicyScope;
  /** The agent follows it now. */
  current: boolean;
  /** Listed but not allowed: following it would loop or chain too long. */
  unavailable?: 'cycle' | 'too_deep' | null;
};
