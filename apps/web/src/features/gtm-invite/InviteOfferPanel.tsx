import { PLAN_FEATURES, PLANS } from '@app/features/paywall/plans';
import { SkipButton } from '@app/features/setup/flow/shared';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import ArrowRight from '@phosphor/arrow-right.svg';
import Check from '@phosphor/check.svg';
import type { GtmInviteOffer } from '@service-auth/generated/schemas/gtmInviteOffer';
import { Button } from '@ui';
import { Index, onMount } from 'solid-js';
import { formatFreeMonths } from './core/invite-link';

const PREMIUM = PLANS[1];

/**
 * Replaces the free/paid plan picker for an account that signed up through a
 * GTM invite link: Premium's first month is free, checkout still collects a
 * card, and the promotion is applied server-side when the session is created.
 */
export function InviteOfferPanel(props: {
  offer: GtmInviteOffer;
  finishing: boolean;
  onStartCheckout: () => void;
  onContinueFree: () => void;
}) {
  const analytics = useAnalytics();

  onMount(() => {
    analytics.track('gtm_invite_offer_viewed', {
      link_id: props.offer.linkId,
      promo_code: props.offer.promoCode,
    });
  });

  const freeMonths = () => props.offer.freeMonths;
  const freePeriod = () =>
    freeMonths() === 1 ? 'first month' : `first ${freeMonths()} months`;

  return (
    <div class="flex flex-col gap-6">
      <div class="flex flex-col gap-4 rounded-xl border border-accent/40 bg-accent/5 p-5">
        <div class="flex items-center justify-between gap-3">
          <span class="text-sm font-semibold text-ink">{PREMIUM.name}</span>
          <span class="rounded-full bg-accent px-2.5 py-0.5 text-xs font-semibold text-accent-contrast">
            {formatFreeMonths(freeMonths())}
          </span>
        </div>
        <div class="flex flex-col gap-1">
          <div class="flex items-baseline gap-2">
            <span class="text-3xl font-semibold tracking-tight text-ink">
              $0
            </span>
            <span class="text-sm text-ink-muted">for your {freePeriod()}</span>
          </div>
          <span class="text-xs text-ink-muted">
            then ${PREMIUM.price} per user / month
          </span>
        </div>
        <ul class="flex flex-col gap-2">
          <Index each={PLAN_FEATURES}>
            {(feature) => (
              <li class="flex items-center justify-between gap-2 text-xs">
                <span class="flex items-center gap-1.5 text-ink-muted">
                  <Check class="size-3 text-accent" />
                  {feature().label}
                </span>
                <span class="font-medium text-ink">
                  {feature().values.premium}
                </span>
              </li>
            )}
          </Index>
        </ul>
      </div>

      <p class="text-xs leading-relaxed text-ink-muted">
        You'll add a card at checkout so Premium keeps going after your{' '}
        {freePeriod()}. Nothing is charged until then, and you can cancel
        anytime before.
      </p>

      <div class="flex flex-col gap-3">
        <Button
          variant="cta"
          size="xl"
          disabled={props.finishing}
          onClick={() => props.onStartCheckout()}
        >
          {props.finishing ? 'Heading to checkout…' : 'Claim your free month'}
          <ArrowRight class="size-5" />
        </Button>
        <SkipButton
          label="Continue with Free instead"
          disabled={props.finishing}
          onClick={() => props.onContinueFree()}
        />
      </div>
    </div>
  );
}
