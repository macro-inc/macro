import { DEFAULT_ROUTE } from '@app/constants/defaultRoute';
import {
  useCheckout,
  useSignUpAndConnectEmail,
} from '@app/signal/email-connect';
import { withAnalytics } from '@coparse/analytics';
import { useHasPaidAccess } from '@core/auth/license';
import { BrightJoins } from '@core/component/BrightJoins';
import BrightJoinsProgressMeter from '@core/component/BrightJoinsProgressMeter';
import { ActionSequence } from '@core/component/FormControls/ActionSequence';
import MacroLogo from '@core/component/MacroLogo';
import { useNavigate } from '@solidjs/router';
import { createEffect, createSignal, Show } from 'solid-js';

export default function Onboarding() {
  const { track, TrackingEvents } = withAnalytics();

  const [progress, setProgress] = createSignal(0);
  const subscribed = useHasPaidAccess();

  const [authenticatedState, signUpAndConnectEmail] =
    useSignUpAndConnectEmail();

  const [_, checkout] = useCheckout();

  const authenticated = () => authenticatedState().type === 'authenticated';

  const navigate = useNavigate();

  // TRACK PROGRESS, REDIRECT ON COMPLETE
  createEffect(() => {
    const steps = [authenticated(), subscribed()];

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
    return navigate(DEFAULT_ROUTE);
  }

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
            {
              label: 'Authenticate with Google',
              onClick: signUpAndConnectEmail,
              disabled: authenticatedState().type === 'authenticating',
              completed: authenticatedState().type === 'authenticated',
            },
            {
              label: 'Start Your Subscription',
              onClick: checkout,
              disabled: authenticatedState().type !== 'authenticated',
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
