import { t } from '@app/lib/i18n';
import type {
  ToolPermissionSourceCandidate,
  ToolPermissionSourceScope,
} from '@service-agent-harness/generated/schemas';
import { match } from 'ts-pattern';

/** Whose a policy is: "Personal", "Team · Acme", or "Team" when the team's name couldn't be read. */
export function scopeLabel(
  scope: ToolPermissionSourceScope | null | undefined
): string | undefined {
  if (!scope) return undefined;
  if (scope.kind === 'personal') return t('agentPermissions.scopePersonal');
  return 'teamName' in scope && scope.teamName
    ? t('agentPermissions.scopeTeam', { team: scope.teamName })
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
