import { t } from '@app/lib/i18n';
import type {
  ToolPermissionSourceCandidate,
  ToolPermissionSourceScope,
} from '@service-agent-harness/generated/schemas';
import { match } from 'ts-pattern';

/**
 * Whose a policy is: "Personal", "Team · Acme", or "Team" when the team's
 * name couldn't be read. The name comes from the policy's `team` (the
 * scope's own name field isn't relied on).
 */
export function scopeLabel(policy: {
  scope?: ToolPermissionSourceScope | null;
  team?: { name: string } | null;
}): string | undefined {
  const scope = policy.scope;
  if (!scope) return undefined;
  if (scope.kind === 'personal') return t('agentPermissions.scopePersonal');
  const name =
    policy.team?.name ?? ('team_name' in scope ? scope.team_name : undefined);
  return name
    ? t('agentPermissions.scopeTeam', { team: name })
    : t('agentPermissions.scopeTeamOnly');
}

/** A policy's name: its agent's, or "Team default" for a team's. */
export function policyName(policy: {
  agent?: { name: string } | null;
  kind?: string | null;
}): string {
  if (policy.agent) return policy.agent.name;
  return policy.kind === 'team' ? t('agentPermissions.teamDefault') : '';
}

/** Why a candidate can't be picked, if it can't. */
export function unavailableReason(
  candidate: ToolPermissionSourceCandidate
): string | undefined {
  if (!candidate.unavailable) return undefined;
  return match(candidate.unavailable)
    .with('cycle', () => t('agentPermissions.sourceWouldLoop'))
    .with('too_deep', () => t('agentPermissions.sourceTooDeep'))
    .exhaustive();
}
