import { useUserInfo } from '@core/context/user';
import type { Accessor } from 'solid-js';

/**
 * Accounts created on or after this date get the Getting Started experience.
 * Older accounts never see it — the checklist assumes the fresh-signup
 * starter content (support channel, how-to guide, starter tasks). Accounts
 * that predate creation-time tracking have no `createdAt` at all and are
 * treated as old.
 */
export const GETTING_STARTED_MIN_ACCOUNT_CREATED = new Date(
  '2026-07-28T00:00:00Z'
);

/**
 * Whether the current account is new enough for the Getting Started
 * experience. `false` while user info is still loading.
 */
export function useGettingStartedEnabled(): Accessor<boolean> {
  const userInfo = useUserInfo();
  return () => {
    const createdAt = userInfo()?.createdAt;
    if (!createdAt) return false;
    return new Date(createdAt) >= GETTING_STARTED_MIN_ACCOUNT_CREATED;
  };
}
