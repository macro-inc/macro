import { InviteOfferPanel } from '@app/features/gtm-invite/InviteOfferPanel';
import { isMobile } from '@core/mobile/isMobile';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { storeListingUrl } from '@core/mobile/native-update-link';
import { useUserInfoQuery } from '@queries/auth/user-info';
import { useNavigate, useSearchParams } from '@solidjs/router';
import type { JSX } from 'solid-js';
import { createEffect, createSignal, Match, onMount, Switch } from 'solid-js';
import { OnboardingProvider } from './context/onboarding-context';
import { type AppHandoff, appHandoffFromParams } from './core/app-handoff';
import { parseCheckoutReturn } from './core/checkout';
import { phoneStorePlatform } from './core/desktop-handoff';
import { parseOnboardingStepParam } from './core/steps';
import { createAppOnboardingContext } from './create-app-onboarding-context';
import { readAppHandoff, saveAppHandoff } from './primitives/flow-storage';
import { AppHandoffView } from './views/app-handoff-view';
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
  // A sign-up the native app started ends by handing its session back to
  // the app. Otherwise phone browsers end on "Macro is better on desktop"
  // before entering the app; computers and the native apps go straight in.
  // Decided as onboarding finishes, so a rotation mid-flow counts. A phone
  // held sideways is wider than `isMobile()`'s 640px and goes straight in,
  // like a tablet.
  const storePlatform = phoneStorePlatform(navigator.userAgent);
  const [ending, setEnding] = createSignal<OnboardingEnding>();
  const finished = (target: string) => {
    const appHandoff = readAppHandoff();
    if (appHandoff) setEnding({ t: 'app', handoff: appHandoff });
    else if (isMobile() && !isNativeMobilePlatform())
      setEnding({ t: 'desktop', target });
    else navigate(target, { replace: true });
  };
  const flow = () => (
    <OnboardingFlowView
      next={
        props.next ??
        (typeof params.next === 'string' ? params.next : undefined)
      }
      step={requestedStep}
      checkoutReturn={parseCheckoutReturn(params)}
      onNavigate={(target) => navigate(target, { replace: true })}
      onFinished={finished}
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
      <Switch fallback={flow()}>
        <Match
          when={(() => {
            const end = ending();
            return end?.t === 'app' ? end.handoff : undefined;
          })()}
          keyed
        >
          {(handoff) => <AppHandoffView handoff={handoff} />}
        </Match>
        <Match
          when={(() => {
            const end = ending();
            return end?.t === 'desktop' ? end.target : undefined;
          })()}
          keyed
        >
          {(target) => (
            <DesktopHandoffView
              storeUrl={storeListingUrl(storePlatform)}
              platform={storePlatform}
              onContinue={() => navigate(target, { replace: true })}
            />
          )}
        </Match>
      </Switch>
    </OnboardingProvider>
  );
}

type OnboardingEnding =
  | { t: 'app'; handoff: AppHandoff }
  | { t: 'desktop'; target: string };

/**
 * Remembers the native app that sent this tab to sign up (`/signup` carries
 * its challenge), so the sign-up can end by handing the session back to it.
 * A link without one leaves an earlier handoff in place.
 */
export function rememberAppHandoff(params: Record<string, unknown>) {
  const handoff = appHandoffFromParams(params, Date.now());
  if (handoff) saveAppHandoff(handoff);
}

/** The native app this tab's sign-up hands its session back to, if any. */
export const pendingAppHandoff = readAppHandoff;

/** The last screen of an app-started sign-up, for hosts outside the flow. */
export function OnboardingAppHandoff(props: { handoff: AppHandoff }) {
  return (
    <OnboardingProvider value={createAppOnboardingContext()}>
      <AppHandoffView handoff={props.handoff} />
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
