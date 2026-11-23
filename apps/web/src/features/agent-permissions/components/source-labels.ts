import { t } from '@app/lib/i18n';
import { match } from 'ts-pattern';
import type { PolicyScope, SourceCandidate } from '../queries/references-view';

/** Whose a policy is: "Personal" or "Team · Acme". */
export function scopeLabel(scope: PolicyScope): string {
  return match(scope)
    .with({ kind: 'personal' }, () => t('agentPermissions.scopePersonal'))
    .with({ kind: 'team' }, (team) =>
      t('agentPermissions.scopeTeam', { team: team.teamName })
    )
    .exhaustive();
}

/** Why a candidate can't be picked, if it can't. */
export function unavailableReason(
  candidate: SourceCandidate
): string | undefined {
  if (!candidate.unavailable) return undefined;
  return match(candidate.unavailable)
    .with('cycle', () => t('agentPermissions.sourceWouldLoop'))
    .with('too_deep', () => t('agentPermissions.sourceTooDeep'))
    .exhaustive();
}
