import {
  type EntityLoadError,
  toEntityLoadError,
} from '@core/component/EntityLoadGate';

/**
 * The gate error for a channel's timeline. Pagination and background-refresh
 * failures keep loaded messages on screen, unless they say the viewer lost
 * access: a channel they were removed from must not keep rendering its cached
 * messages.
 */
export function timelineLoadError(query: {
  error: unknown;
  isLoadingError: boolean;
}): EntityLoadError | undefined {
  const error = toEntityLoadError(query.error);
  const accessLost = error === 'UNAUTHORIZED' || error === 'FORBIDDEN';
  return query.isLoadingError || accessLost ? error : undefined;
}
