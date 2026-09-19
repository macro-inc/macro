import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useIsAuthenticated } from '@core/context/user';
import { thrownResultErrorHasCode } from '@core/util/result';
import { useRedeemGtmInviteLinkMutation } from '@queries/gtm-invite/links';
import { createEffect, on } from 'solid-js';
import {
  clearPendingInviteToken,
  getPendingInviteToken,
} from './core/invite-link';

/**
 * Finishes the invite handoff once the visitor has an account. The welcome
 * page parks the token in localStorage before sending them to sign up; the
 * first authenticated load redeems it, which attributes the account to the
 * staff member who sent the link and unlocks the free-month offer.
 *
 * Redemption is idempotent server-side, so an extra attempt is harmless.
 * Anything but an auth failure is terminal (unknown, expired, already used
 * by someone else) and drops the token rather than retrying forever.
 */
export function usePendingInviteRedemption() {
  const isAuthenticated = useIsAuthenticated();
  const analytics = useAnalytics();
  const redeem = useRedeemGtmInviteLinkMutation({
    onSuccess: (offer) => {
      clearPendingInviteToken();
      analytics.track('gtm_invite_redeemed', {
        link_id: offer.linkId,
        promo_code: offer.promoCode,
      });
    },
    onError: (error) => {
      if (thrownResultErrorHasCode(error, 'UNAUTHORIZED')) return;
      clearPendingInviteToken();
      console.error('Failed to redeem GTM invite link', error);
    },
  });

  let attempted = false;
  createEffect(
    on(isAuthenticated, (authenticated) => {
      if (authenticated !== true || attempted) return;
      const token = getPendingInviteToken();
      if (!token) return;
      attempted = true;
      redeem.mutate({ token });
    })
  );
}
