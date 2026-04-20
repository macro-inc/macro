import { useHasPaidAccess } from '@core/auth';
import { toast } from '@core/component/Toast/Toast';
import { type PaywallKey, PaywallMessages } from '@core/constant/PaywallState';
import { usePermissions } from '@core/context/user';
import IconX from '@icon/regular/x.svg';
import { invalidateUserInfo } from '@queries/auth/user-info';
import { stripeServiceClient } from '@service-stripe/client';
import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import { useAnalytics } from '@app/component/analytics-context';
import { PLANS, type PlanTier } from './plans';

interface PaywallComponent {
  cb: () => Promise<void> | void;
  handleGuest?: () => void;
  isOnboarding?: boolean;
  errorKey?: PaywallKey | null;
  customType?: string;
  hideCloseButton?: boolean;
}

const PaywallComponent = (props: PaywallComponent) => {
  const analytics = useAnalytics();
  const permissions = usePermissions();
  const hasPaid = useHasPaidAccess();

  // Tier a paying user is currently subscribed to, derived from RBAC permissions
  // (sub_opus grants write:opus; sub_sonnet grants write:sonnet + write:haiku;
  // sub_haiku grants write:haiku — so check highest-to-lowest).
  const currentTier = createMemo((): PlanTier | undefined => {
    if (!hasPaid()) return undefined;
    const perms = permissions();
    if (perms.includes('write:opus')) return 'opus';
    if (perms.includes('write:sonnet')) return 'sonnet';
    if (perms.includes('write:haiku')) return 'haiku';
    return undefined;
  });

  const [selectedTier, setSelectedTier] = createSignal<PlanTier>('sonnet');
  // Seed `selectedTier` from `currentTier` once, the first time permissions resolve.
  // Re-syncing on every `currentTier` change would clobber the user's active selection
  // if permissions later refetch (post-update invalidation, multi-tab, etc.).
  let seededFromCurrentTier = false;
  createEffect(() => {
    if (seededFromCurrentTier) return;
    const tier = currentTier();
    if (tier) {
      setSelectedTier(tier);
      seededFromCurrentTier = true;
    }
  });

  const [updating, setUpdating] = createSignal(false);

  const handleCheckout = async (tier: PlanTier) => {
    try {
      await props.cb();
      const url = await stripeServiceClient.createCheckoutSession(
        props.customType ? props.customType : (props.errorKey ?? undefined),
        undefined,
        tier
      );
      analytics.track('subscription_start', {
        type: tier,
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
    if (hasPaid()) {
      manageSubscription();
      return;
    }
    handleCheckout(selectedTier());
  };

  const handleUpdateTier = async () => {
    const next = selectedTier();
    const prev = currentTier();
    if (!prev || next === prev) return;
    setUpdating(true);
    try {
      const result = await stripeServiceClient.updateSubscriptionTier(next);
      if (!result.ok) {
        // Messages mirror the backend's StripeOperationError `Display` impls, adapted
        // to second-person for UI. Switch on `result.code` — TS enforces exhaustiveness
        // against `PatchSubscriptionTierErrorCode | 'UNKNOWN'`.
        switch (result.code) {
          case 'USER_IN_TEAM':
            toast.failure('Contact your team owner to update.');
            break;
          case 'UPDATE_IN_PROGRESS':
            toast.failure(
              'Another subscription update is already in progress. Please try again in a moment.'
            );
            break;
          case 'NO_SUBSCRIPTION':
            toast.failure("You don't have an active subscription to update.");
            break;
          case 'TIER_UNCHANGED':
            toast.failure('Subscription is already on the requested tier.');
            break;
          case 'UNKNOWN':
            toast.failure('Failed to update subscription.');
            break;
        }
        return;
      }
      analytics.track('subscription_tier_updated', { from: prev, to: next });
      // Refetches permissions so `currentTier` reflects the new tier and this button
      // auto-hides (selectedTier === currentTier).
      await invalidateUserInfo();
      toast.success('Subscription updated!');
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div class="space-y-6 sm:space-y-8 w-full">
      <div class="relative w-full text-center">
        <Show when={!props.hideCloseButton}>
          <button
            onClick={props.cb}
            class="fixed top-6 right-6 sm:top-3 sm:right-3 text-ink-extra-muted hover:text-ink transition-colors"
          >
            <IconX class="w-5 sm:w-6 h-5 sm:h-6" />
          </button>
        </Show>
        <Show when={!hasPaid()}>
          <div class="space-y-6 sm:space-y-8">
            <div class="text-center">
              <h2 class="mb-2 font-semibold text-ink text-xl sm:text-2xl">
                Choose your plan
              </h2>
              <Show when={props.errorKey}>
                <p class="mb-4 text-failure-ink text-sm sm:text-base">
                  {PaywallMessages[props.errorKey as PaywallKey]}
                </p>
              </Show>
            </div>
          </div>
        </Show>
      </div>

      <div class="mx-auto mt-6 w-full max-w-2xl">
        <div class="gap-3 sm:gap-4 grid grid-cols-1 sm:grid-cols-3">
          <For each={PLANS}>
            {(plan) => (
              <button
                onClick={() => setSelectedTier(plan.tier)}
                class="p-4 sm:p-5 border flex flex-col transition-all relative text-left"
                classList={{
                  'border-accent ring-1 ring-accent bg-active':
                    selectedTier() === plan.tier,
                  'border-edge hover:border-edge': selectedTier() !== plan.tier,
                }}
                style={{ 'border-radius': '2px' }}
              >
                <div class="flex flex-col gap-3 w-full">
                  <div class="flex justify-between items-start">
                    <div>
                      <div class="font-semibold text-ink text-base sm:text-lg">
                        {plan.name}
                      </div>
                    </div>
                    {selectedTier() === plan.tier && (
                      <div class="bg-accent w-3 sm:w-4 h-3 sm:h-4 shrink-0"></div>
                    )}
                  </div>
                  <div class="flex items-baseline gap-0.5">
                    <span class="text-3xl font-bold text-ink">
                      ${plan.price}
                    </span>
                    <span class="text-base text-ink/40">/mo</span>
                  </div>
                  <div class="text-sm text-ink/60 flex flex-col gap-1">
                    <For each={plan.features}>
                      {(feature) => <span>{feature}</span>}
                    </For>
                  </div>
                </div>
              </button>
            )}
          </For>
        </div>
      </div>

      <div class="mx-auto mt-8 max-w-2xl text-center">
        <Show
          when={hasPaid() && currentTier() && selectedTier() !== currentTier()}
          fallback={
            <button
              onClick={handleContinue}
              class={`w-full px-4 py-2 sm:px-6 sm:py-3 font-medium transition-none hover:transition text-sm sm:text-base border border-transparent ${
                hasPaid()
                  ? 'bg-active text-ink border-edge hover:bg-hover hover:border-edge'
                  : 'bg-accent text-page hover:bg-accent-ink'
              }`}
            >
              <Show when={!hasPaid()} fallback={'Manage Subscription'}>
                Get {PLANS.find((p) => p.tier === selectedTier())?.name}
              </Show>
            </button>
          }
        >
          <button
            onClick={handleUpdateTier}
            disabled={updating()}
            class="w-full px-4 py-2 sm:px-6 sm:py-3 font-medium transition-none hover:transition text-sm sm:text-base border border-transparent bg-accent text-page hover:bg-accent-ink disabled:opacity-60"
          >
            {updating() ? 'Updating…' : 'Update Subscription'}
          </button>
        </Show>
        <Show when={!hasPaid() && props.handleGuest}>
          <button
            onClick={() => props.handleGuest?.()}
            class="mt-3 text-xs text-ink/40 hover:text-ink/60 underline"
          >
            Continue with free plan
          </button>
        </Show>
      </div>
    </div>
  );
};

export default PaywallComponent;
