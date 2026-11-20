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

/** How long ago `since` was, in whole minutes, hours or days. */
export function sinceLabel(since: string): string {
  const now = new Date();
  const length = waitingFor(since, now);
  if (length) {
    return length.unit === 'days'
      ? t('suggestions.ageDays', { count: length.count })
      : t('suggestions.ageHours', { count: length.count });
  }

  const minutes = Math.floor((now.getTime() - Date.parse(since)) / 60_000);
  return minutes >= 1
    ? t('suggestions.ageMinutes', { count: minutes })
    : t('suggestions.ageNow');
}

/**
 * How long a suggestion has waited: since the message still unanswered
 * came, else since it was proposed.
 */
export function ageLabel(suggestion: Suggestion): string {
  return sinceLabel(
    (suggestion.kind === 'entity' ? suggestion.waitingSince : undefined) ??
      suggestion.createdAt
  );
}
