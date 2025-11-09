import { useHasPaidAccess } from '@core/auth';
import { type PaywallKey, PaywallMessages } from '@core/constant/PaywallState';
import IconCheck from '@icon/regular/check-circle.svg';
import IconX from '@icon/regular/x.svg';
import Dot from '@phosphor-icons/core/regular/dot.svg?component-solid';
import { useUserInfo } from '@service-gql/client';
import { stripeServiceClient } from '@service-stripe/client';
import { createSignal, For, onMount, Show } from 'solid-js';

const guestFeatures = [
  'Limited to 10 files and 10 AI messages',
  'Can connect but not send emails',
];

const smartFeatures = [
  'Unlimited files',
  'Unlimited email',
  'Unlimited AI',

  // '300 AI messages per month'
];

interface PaywallComponent {
  cb: () => Promise<void> | void;
  handleGuest?: () => void;
  isOnboarding?: boolean;
  errorKey?: PaywallKey | null;
  customType?: string;
  hideCloseButton?: boolean;
}

const PaywallComponent = (props: PaywallComponent) => {
  const [userInfo] = useUserInfo();
  const [hasTrialed, setHasTrialed] = createSignal(false);
  const [selectedPlan, setSelectedPlan] = createSignal<'guest' | 'member'>(
    'member'
  );
  const hasPaid = useHasPaidAccess();

  onMount(() => {
    if (userInfo()[1]?.hasTrialed) {
      setHasTrialed(true);
    }
  });

  const handleEarlyMember = async () => {
    try {
      await props.cb();
      const url = await stripeServiceClient.createCheckoutSession(
        props.customType ? props.customType : (props.errorKey ?? undefined)
      );
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
    if (selectedPlan() === 'guest') {
      props.handleGuest?.();
    } else {
      handleEarlyMember();
    }
  };

  const handlePlanSelect = (plan: 'guest' | 'member') => {
    setSelectedPlan(plan);
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
                <Show when={hasTrialed()}>Become an Early Member</Show>
                <Show when={!hasTrialed()}>
                  Want to try Early Member for free?
                </Show>
              </h2>
              <Show when={props.errorKey}>
                <p class="mb-4 text-failure-ink text-sm sm:text-base">
                  {PaywallMessages[props.errorKey as PaywallKey]}
                </p>
              </Show>
              {/* <Show when={!props.errorKey}>
              <p class="mx-auto max-w-md text-ink text-sm sm:text-base">
                <Show when={!hasTrialed()}>
                  If you can afford it, we recommend starting a trial of Early
                  Member for faster and better quality answers.
                </Show>
                <Show when={hasTrialed()}>
                  If you can afford it, we recommend upgrading to Early Member
                  for faster and better quality answers.
                </Show>
              </p>
            </Show> */}
            </div>
          </div>
        </Show>
      </div>

      {/* Plan Selection */}
      <div class="mx-auto mt-6 w-full max-w-2xl">
        <div class="gap-3 sm:gap-4 grid grid-cols-1 sm:grid-cols-2">
          {/* Guest AI */}
          <button
            inert={hasPaid()}
            onClick={() => handlePlanSelect('guest')}
            class={`p-4 sm:p-5 border transition-all duration-200 relative text-left flex flex-col  ${
              selectedPlan() === 'guest'
                ? 'border-ink bg-edge/15'
                : 'border-edge hover:border-edge'
            }`}
          >
            <div class="flex flex-col gap-3">
              <div class="flex justify-between items-start">
                <div>
                  <div class="font-semibold text-ink text-base sm:text-lg">
                    Guest
                  </div>
                  <Show when={!hasPaid()}>
                    <div class="text-ink text-sm">
                      Free (no credit card required)
                    </div>
                  </Show>
                </div>
                {selectedPlan() === 'guest' && (
                  <div class="bg-ink w-3 sm:w-4 h-3 sm:h-4"></div>
                )}
              </div>
              <ul class="space-y-2">
                <For each={guestFeatures}>
                  {(feature) => (
                    <li class="flex items-center gap-2 text-ink text-sm">
                      <IconCheck class="w-4 h-4 text-ink-muted shrink-0" />
                      {feature}
                    </li>
                  )}
                </For>
              </ul>
            </div>
          </button>

          {/* Early Member */}
          <button
            inert={hasPaid()}
            onClick={() => handlePlanSelect('member')}
            class={`p-4 sm:p-5 border flex flex-col transition-all relative text-left ${
              selectedPlan() === 'member'
                ? 'border-ink bg-active'
                : 'border-edge hover:border-edge'
            }`}
          >
            <div class="flex flex-col gap-3">
              <div class="flex justify-between items-start">
                <div classList={{ 'flex items-center gap-1': hasTrialed() }}>
                  <div class="font-semibold text-ink text-base sm:text-lg">
                    Early Member
                  </div>
                  <div class="flex gap-1 items-center text-ink text-sm">
                    <Show when={!hasTrialed()}>
                      7 days free, then $20/month
                    </Show>
                    <Show when={hasTrialed()}>
                      <div class="flex items-center justify-center w-[1ch] relative">
                        <Dot class="h-8 shrink-0" />
                      </div>
                      <span>$20/month</span>
                    </Show>
                  </div>
                </div>
                {selectedPlan() === 'member' && (
                  <div class="bg-ink w-3 sm:w-4 h-3 sm:h-4"></div>
                )}
              </div>
              <ul class="space-y-2">
                <For each={smartFeatures}>
                  {(feature) => (
                    <li class="flex items-center gap-2 text-ink text-sm">
                      <IconCheck class="w-4 h-4 text-ink-muted shrink-0" />
                      {feature}
                    </li>
                  )}
                </For>
              </ul>
            </div>
          </button>
        </div>
      </div>

      <div class="mx-auto mt-8 max-w-2xl text-center">
        <button
          onClick={handleContinue}
          class={`w-full px-4 py-2 sm:px-6 sm:py-3 font-medium transition-none hover:transition text-sm sm:text-base border border-transparent ${
            selectedPlan() === 'guest' || hasPaid()
              ? 'bg-active text-ink border-edge hover:bg-hover hover:border-edge'
              : 'bg-accent text-page hover:bg-accent-ink'
          }`}
        >
          <Show when={!hasPaid()} fallback={'Manage Subscription'}>
            <Show when={selectedPlan() === 'guest'}>Continue with Guest</Show>
            <Show when={selectedPlan() === 'member'}>
              <Show when={!hasTrialed()}>Start 7 day trial</Show>
              <Show when={hasTrialed()}>Become an Early Member</Show>
            </Show>
          </Show>
        </button>
      </div>
    </div>
  );
};

export default PaywallComponent;
