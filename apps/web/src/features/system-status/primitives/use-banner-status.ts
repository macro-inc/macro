import { useCurrentSystemStatusQuery } from '@queries/system-status/status';
import { type BannerStatus, bannerStatus } from '../core/status';

/**
 * The banner every user sees while Macro is not operational. Never suspends:
 * until the status loads, and through failed refetches, it shows whatever was
 * last known (nothing at first).
 */
export function useBannerStatus(): () => BannerStatus | undefined {
  const query = useCurrentSystemStatusQuery();
  return () => {
    if (query.isPending) return undefined;
    return query.data ? bannerStatus(query.data) : undefined;
  };
}
