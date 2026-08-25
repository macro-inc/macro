import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useHasPaidAccess } from '@core/auth';
import { type PaywallKey, PaywallMessages } from '@core/constant/PaywallState';
import { useUserId } from '@core/context/user';
import { plural } from '@core/util/string';
import ArrowSquareOutIcon from '@phosphor/arrow-square-out.svg';
import CheckIcon from '@phosphor/check.svg';
import { useCurrentTeamQuery } from '@queries/team/teams';
import { stripeServiceClient } from '@service-stripe/client';
import { Button, Tooltip } from '@ui';
import { createMemo, For, Show } from 'solid-js';

export interface PaywallProps {
  cb: () => Promise<void> | void;
  handleGuest?: () => void;
  isOnboarding?: boolean;
  errorKey?: PaywallKey | null;
  customType?: string;
  hideCloseButton?: boolean;
}

const PAYWALL_PREMIUM_FEATURES = [
  'All agents',
  'All models',
  'No watermark',
  'AI projections',
  'Multiple email inboxes',
  'Calls',
  'Teams',
  '1 TB storage',
];

const PremiumFeatures = () => (
  <ul class="grid grid-cols-1 gap-x-4 gap-y-3 text-sm text-ink-muted sm:grid-cols-3">
    <For each={PAYWALL_PREMIUM_FEATURES}>
      {(label) => (
        <li class="flex items-center gap-2">
          <CheckIcon class="size-3 text-success" />
          <span class="text-ink-muted text-xs">{label}</span>
        </li>
      )}
    </For>
  </ul>
);

const PaywallComponent = (props: PaywallProps) => {
  const analytics = useAnalytics();
  const hasPaid = useHasPaidAccess();
  const userId = useUserId();

  const team = useCurrentTeamQuery();

  const teamRole = createMemo(() => {
    const uid = userId();
    const currentTeam = team.data;

    if (!currentTeam) return;

    return currentTeam.team.owner_id === uid ? 'owner' : 'member';
  });

  const upgradeDisabled = createMemo(() => teamRole() === 'member');

  const handleCheckout = async () => {
    try {
      await props.cb();
      const url = await stripeServiceClient.createCheckoutSessionV2({
        type: props.customType
          ? props.customType
          : (props.errorKey ?? undefined),
      });
      analytics.track('subscription_start', {
        type: 'premium',
        customType: props.customType,
        errorKey: props.errorKey,
      });
      window.location.href = url;
    } catch (error) {
      console.error(error);
    }
  };

  const manageSubscription = async () => {
    try {
      const url = await stripeServiceClient.createPortalSession();
      window.location.href = url;
    } catch (error) {
      console.error(error);
    }
  };

  const handleContinue = () => {
    if (upgradeDisabled()) return;

    if (hasPaid()) {
      manageSubscription();
      return;
    }
    handleCheckout();
  };

  const ctaLabel = () => (hasPaid() ? 'Manage Subscription' : 'Upgrade now');
  const paywallMetadata = () =>
    props.errorKey ? PaywallMessages[props.errorKey] : undefined;

  return (
    <section class="relative flex w-full flex-col gap-6">
      <div class="grid grid-cols-1 gap-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] p-6 sm:px-8 sm:pt-8 sm:pb-4">
        <section class="flex flex-col gap-4">
          <div class="flex flex-col gap-2">
            <h2 class="text-2xl text-ink font-semibold">
              Unlock Premium features
            </h2>
            <p class="text-sm text-ink-extra-muted">
              {paywallMetadata()?.description ??
                'Upgrade your workspace with more AI power, team collaboration, and room to grow.'}
            </p>
            <Show when={paywallMetadata()?.learnMoreUrl}>
              {(learnMoreUrl) => (
                <a
                  class="mt-16 inline-flex items-center gap-1 self-start text-xs text-link hover:text-link-hover visited:text-link-visited"
                  href={learnMoreUrl()}
                  target="_blank"
                  rel="noopener"
                >
                  Learn more about{' '}
                  {paywallMetadata()!.learnMoreSubject ?? 'Premium'}
                  <ArrowSquareOutIcon class="size-4" />
                </a>
              )}
            </Show>
          </div>
        </section>

        <section class="h-full flex flex-col gap-3">
          <div class="flex flex-1 flex-col gap-4 rounded-lg bg-active p-4">
            <div class="flex flex-col">
              <h3 class="text-sm text-ink">Premium features</h3>
            </div>
            <PremiumFeatures />
          </div>
        </section>
      </div>

      <div class="border-t border-t-edge px-8 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex items-baseline gap-1.5 text-xs text-ink/60">
          <span class="text-ink font-semibold text-xl leading-6">$40</span>
          <span>per seat / per month</span>

          <Show when={teamRole() === 'owner' && team.data}>
            {(team) => (
              <span class="text-ink-extra-muted text-xs">
                • {team().members.length}{' '}
                {plural('user', team().members.length)}
              </span>
            )}
          </Show>
        </div>
        <div class="flex flex-col justify-end gap-2 sm:flex-row">
          <Button
            variant="ghost"
            depth={3}
            class="rounded-full sm:w-auto px-3 py-1.5"
            onClick={props.cb}
          >
            Dismiss
          </Button>
          <Show
            when={upgradeDisabled()}
            fallback={
              <Button
                variant={hasPaid() ? 'outline' : 'cta'}
                class="rounded-full sm:w-auto px-3 py-1.5"
                onClick={handleContinue}
              >
                {ctaLabel()}
              </Button>
            }
          >
            <Tooltip
              label="Your subscription is managed by your team owner. Contact them to make changes."
              placement="top"
            >
              <span>
                <Button
                  variant={hasPaid() ? 'outline' : 'cta'}
                  class="rounded-full sm:w-auto px-3 py-1.5"
                  disabled
                >
                  {ctaLabel()}
                </Button>
              </span>
            </Tooltip>
          </Show>
        </div>
      </div>
    </section>
  );
};

export default PaywallComponent;
