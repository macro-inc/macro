import { connectEmail, useEmailAuthStatus } from '@app/signal/emailAuth';
import { withAnalytics } from '@coparse/analytics';
import { updateUserAuth, useIsAuthenticated } from '@core/auth';
import { useHasPaidAccess } from '@core/auth/license';
import { BrightJoins } from '@core/component/BrightJoins';
import BrightJoinsProgressMeter from '@core/component/BrightJoinsProgressMeter';
import { ActionSequence } from '@core/component/FormControls/ActionSequence';
import MacroLogo from '@core/component/MacroLogo';
import { licenseChannel } from '@core/util/licenseUpdateBroadcastChannel';
import { updateUserInfo } from '@service-gql/client';
import { stripeServiceClient } from '@service-stripe/client';
import { useNavigate, useSearchParams } from '@solidjs/router';
import { createEffect, createSignal, onCleanup, Show } from 'solid-js';

export default function Onboarding() {
  const { track, TrackingEvents } = withAnalytics();

  const [progress, setProgress] = createSignal(0);
  const authenticated = useIsAuthenticated();
  const connected = useEmailAuthStatus();
  const subscribed = useHasPaidAccess();

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // TRACK PROGRESS, REDIRECT ON COMPLETE
  createEffect(() => {
    const steps = [connected(), subscribed()];

    const p = steps
      .map((b) => +!!b) // unary + converts bool to int
      .reduce((a, b) => a + b);

    setProgress((p / steps.length) * 100);

    if (p === steps.length) {
      complete();
    }
  });

  function complete() {
    // Redirect on completion
    if (localStorage.getItem('new_user_onboarding')) {
      track(TrackingEvents.ONBOARDING.COMPLETE);
      localStorage.removeItem('new_user_onboarding');
    }
    return navigate('/unified-list');
  }

  // WATCH FOR AUTH SUCCESS
  // createEffect(() => {
  //   const isAuthed = authenticated();
  //   const wasAttemptingSSO = localStorage.getItem('new_user_sso_auth_attempt');

  //   if (isAuthed && wasAttemptingSSO) {
  //     track(TrackingEvents.ONBOARDING.CREATE_ACCOUNT.SSO.GOOGLE.AUTH_SUCCESS);
  //     localStorage.removeItem('new_user_sso_auth_attempt');
  //   }
  // });

  // WATCH FOR SUBSCRIPTION SUCCESS
  createEffect(() => {
    const subscriptionSuccess = searchParams.subscriptionSuccess;
    if (subscriptionSuccess === 'true') {
      track(TrackingEvents.ONBOARDING.SUBSCRIBE.CHECKOUT_SUCCESS);
      updateUserInfo();
    }
  });

  // Listen for license updates across browser tabs
  createEffect(() => {
    const unlisten = licenseChannel.subscribe(() => {
      updateUserInfo();
    });

    onCleanup(unlisten);
  });

  // const location = useLocation<RedirectLocation>();
  // const startSsoLogin = async (idp_name: string) => {
  //   localStorage.setItem('new_user_onboarding', 'true');
  //   localStorage.setItem('new_user_sso_auth_attempt', 'true');

  //   track(TrackingEvents.ONBOARDING.START);
  //   track(TrackingEvents.ONBOARDING.CREATE_ACCOUNT.SSO.GOOGLE.AUTH_START);

  //   const authUrl = new URL(`${SERVER_HOSTS['auth-service']}/login/sso`);
  //   authUrl.searchParams.set('idp_name', idp_name);
  //   if (location.state?.originalLocation) {
  //     const { pathname, search, hash } = location.state.originalLocation;
  //     authUrl.searchParams.set(
  //       'original_url',
  //       `${window.location.origin}${pathname}${search}${hash}`
  //     );
  //   } else {
  //     authUrl.searchParams.set('original_url', window.location.href);
  //   }
  //   window.location.href = authUrl.toString();
  // };

  // ALSO AUTHS!
  const connectInbox = async () => {
    track(TrackingEvents.ONBOARDING.GMAIL.CONNECT_START);
    try {
      await connectEmail();
    } catch (error) {
      track(TrackingEvents.ONBOARDING.GMAIL.CONNECT_FAILURE, { ...error });
      console.error(error);
    }

    if (connected()) track(TrackingEvents.ONBOARDING.GMAIL.CONNECT_SUCCESS);
    await updateUserAuth();
    if (subscribed()) complete();
  };

  const handlePayment = async () => {
    try {
      track(TrackingEvents.ONBOARDING.SUBSCRIBE.CHECKOUT_START);
      const url =
        await stripeServiceClient.createCheckoutSession('New subscription');
      window.location.href = url;
    } catch (error) {
      track(TrackingEvents.ONBOARDING.SUBSCRIBE.CHECKOUT_FAILURE, { ...error });
      console.error(error);
    }
  };

  return (
    <div class="relative flex flex-col gap-4 justify-between items-center p-4 md:p-8 m-1 md:m-8 border border-edge">
      <BrightJoins />
      <BrightJoinsProgressMeter progress={progress()} />

      <header
        class="flex max-md:flex-col w-full items-center gap-8"
        classList={{
          'justify-between': !authenticated(),
        }}
      >
        <div class="w-40">
          <MacroLogo class="fill-ink-muted" />
        </div>

        <Show when={!authenticated()}>
          <p class="font-mono text-ink-extra-muted text-xs">
            Already have an account?{' '}
            <a
              onClick={() => {
                localStorage.removeItem('onboarding_state');
                navigate('/login');
              }}
              class="hover:text-ink decoration-solid hover:decoration-dashed underline underline-offset-2 cursor-pointer"
            >
              Sign in
            </a>
          </p>
        </Show>
      </header>

      <section class="flex flex-col gap-8 w-max pb-8 -mt-16">
        <div class="space-y-2">
          <h1 class="font-semibold text-5xl">Boot Sequence</h1>
          <p class="font-medium text-ink-muted">
            Let's initialize your new workspace.
          </p>
        </div>

        <ActionSequence
          steps={[
            // {
            //   label: 'Authenticate with Google',
            //   onClick: () => startSsoLogin('google'),
            //   disabled: !!authenticated(),
            //   completed: !!authenticated(),
            // },
            {
              label: 'Authenticate with Google',
              onClick: connectInbox,
              disabled: authenticated() || connected(),
              completed: connected(),
            },
            {
              label: 'Start Your Subscription',
              onClick: handlePayment,
              disabled: !authenticated() || !connected(),
              completed: subscribed(),
            },
          ]}
        />
      </section>

      <footer class="text-ink-placeholder">
        <p class="text-center text-xs">
          By signing up, you agree to our{' '}
          <a
            class="underline hover:decoration-dashed decoration-solid"
            href="/terms"
          >
            terms
          </a>{' '}
          and{' '}
          <a
            class="underline hover:decoration-dashed decoration-solid"
            href="/privacy"
          >
            privacy policy
          </a>
          .
        </p>
      </footer>
    </div>
  );
}
