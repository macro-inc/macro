import { t } from '@app/lib/i18n';
import { type Suggestion, waitingFor } from '../core/suggestion';

/**
 * "waiting 2 days" for an open reply suggestion whose sender still waits;
 * undefined for anything else, or under an hour.
 */
export function waitingLabel(suggestion: Suggestion): string | undefined {
  if (
    suggestion.status !== 'open' ||
    suggestion.kind !== 'entity' ||
    !suggestion.waitingSince
  ) {
    return undefined;
  }

  const length = waitingFor(suggestion.waitingSince, new Date());
  if (!length) return undefined;

  return length.unit === 'days'
    ? t('suggestions.waitingDays', { count: length.count })
    : t('suggestions.waitingHours', { count: length.count });
}
