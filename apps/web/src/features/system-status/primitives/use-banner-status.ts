import { useCurrentSystemStatusQuery } from '@queries/system-status/status';
import { createSignal } from 'solid-js';
import { type BannerStatus, bannerStatus } from '../core/status';

/**
 * The banner every user sees while Macro is not operational. Never suspends:
 * until the status loads, and through failed refetches, it shows whatever was
 * last known (nothing at first).
 *
 * Dismissing hides the current banner until the page reloads. It is kept in
 * memory only, so a new level or message always shows.
 */
export function useBannerStatus(): {
  status: () => BannerStatus | undefined;
  dismiss: () => void;
} {
  const query = useCurrentSystemStatusQuery();
  const [dismissed, setDismissed] = createSignal<BannerStatus>();
  const current = () => {
    if (query.isPending) return undefined;
    return query.data ? bannerStatus(query.data) : undefined;
  };
  const status = () => {
    const banner = current();
    const hidden = dismissed();
    if (
      banner &&
      hidden &&
      banner.level === hidden.level &&
      banner.message === hidden.message
    ) {
      return undefined;
    }
    return banner;
  };
  return { status, dismiss: () => setDismissed(current()) };
}
