import { InviteOfferPanel } from '@app/features/gtm-invite/InviteOfferPanel';
import { isMobile } from '@core/mobile/isMobile';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { storeListingUrl } from '@core/mobile/native-update-link';
import { useUserInfoQuery } from '@queries/auth/user-info';
import { useNavigate, useSearchParams } from '@solidjs/router';
import type { JSX } from 'solid-js';
import { createEffect, createSignal, onMount, Show } from 'solid-js';
import { OnboardingProvider } from './context/onboarding-context';
import { parseCheckoutReturn } from './core/checkout';
import { phoneStorePlatform } from './core/desktop-handoff';
import { parseOnboardingStepParam } from './core/steps';
import { createAppOnboardingContext } from './create-app-onboarding-context';
import { DesktopHandoffView } from './views/desktop-handoff-view';
import { OnboardingFlowView } from './views/onboarding-flow-view';
import { SignupJourneyView } from './views/signup-journey-view';

/**
 * The signed-in onboarding flow, wired to the app's services and router.
 * `next` overrides the page's own `?next`, for hosts (sign-in) whose deep
 * link arrives under another name.
 */
export function Onboarding(props: { next?: string }) {
  const context = createAppOnboardingContext();
  const navigate = useNavigate();
  const userInfoQuery = useUserInfoQuery();
  // Agents never onboard, even when they open the link directly.
  createEffect(() => {
    if (userInfoQuery.data?.isAgent) navigate('/', { replace: true });
  });
  const [params, setParams] = useSearchParams();
  // Captured once. The link is removed below, and later progress must win
  // on reload instead of the original step.
  const requestedStep = parseOnboardingStepParam(params.step);
  onMount(() => {
    if (params.step === undefined) return;
    setParams({ step: undefined }, { replace: true });
  });
  // Phone browsers end on "Macro is better on desktop" before entering the
  // app; computers and the native apps go straight in.
  const storePlatform = phoneStorePlatform(navigator.userAgent);
  const handoffStoreUrl =
    isMobile() && !isNativeMobilePlatform()
      ? storeListingUrl(storePlatform)
      : undefined;
  const [handoffTarget, setHandoffTarget] = createSignal<string>();
  const flow = () => (
    <OnboardingFlowView
      next={
        props.next ??
        (typeof params.next === 'string' ? params.next : undefined)
      }
      step={requestedStep}
      checkoutReturn={parseCheckoutReturn(params)}
      onNavigate={(target) => navigate(target, { replace: true })}
      onFinished={
        handoffStoreUrl ? (target) => setHandoffTarget(target) : undefined
      }
      onRedirect={(url) => {
        window.location.href = url;
      }}
      onSignedOut={() => navigate('/login', { replace: true })}
      renderInviteOffer={(offer, actions) => (
        <InviteOfferPanel
          offer={offer}
          finishing={actions.finishing()}
          onStartCheckout={actions.onClaim}
          onContinueFree={actions.onContinueFree}
        />
      )}
    />
  );
  return (
    <OnboardingProvider value={context}>
      <Show when={handoffStoreUrl && handoffTarget()} keyed fallback={flow()}>
        {(target) => (
          <DesktopHandoffView
            storeUrl={handoffStoreUrl ?? ''}
            platform={storePlatform}
            onContinue={() => navigate(target, { replace: true })}
          />
        )}
      </Show>
    </OnboardingProvider>
  );
}

/** The signed-out opening slides, hosted by the sign-up page. */
export function OnboardingSignup(props: {
  onGoogle: () => Promise<void>;
  onMicrosoft?: () => Promise<void>;
  onBackFromEmail: () => void;
  onSignIn: () => void;
  onAgentSignup: () => void;
  emailForm?: JSX.Element;
  showingEmail: boolean;
}) {
  return (
    <OnboardingProvider value={createAppOnboardingContext()}>
      <SignupJourneyView {...props} />
    </OnboardingProvider>
  );
}

export { clearSignupDraft } from './primitives/flow-storage';
export { OnboardingPendingView as OnboardingPending } from './views/onboarding-pending-view';
