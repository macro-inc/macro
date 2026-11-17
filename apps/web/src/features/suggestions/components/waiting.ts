import { formatRelativeTimestamp } from '@app/features/entity/utils/timestamp';
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

/**
 * How long a suggestion has waited, in whole hours or days: since the
 * message still unanswered came, else since it was proposed.
 */
export function ageLabel(suggestion: Suggestion): string {
  const since =
    (suggestion.kind === 'entity' ? suggestion.waitingSince : undefined) ??
    suggestion.createdAt;
  const length = waitingFor(since, new Date());
  if (!length) return formatRelativeTimestamp(since, { condensed: true });

  return length.unit === 'days'
    ? t('suggestions.ageDays', { count: length.count })
    : t('suggestions.ageHours', { count: length.count });
}
