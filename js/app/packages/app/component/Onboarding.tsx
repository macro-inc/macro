import { useOnboarding } from '@app/signal/onboarding/onboarding';
import { BrightJoins } from '@core/component/BrightJoins';
import BrightJoinsProgressMeter from '@core/component/BrightJoinsProgressMeter';
import { ActionSequence } from '@core/component/FormControls/ActionSequence';
import MacroLogo from '@core/component/MacroLogo';
import { useNavigate } from '@solidjs/router';
import { Show } from 'solid-js';

export default function Onboarding() {
  const navigate = useNavigate();
  const {
    progress,
    checkout,
    authenticatedState,
    checkoutState,
    signUpAndConnectEmail,
  } = useOnboarding();

  return (
    <div class="relative flex flex-col gap-4 justify-between items-center p-4 md:p-8 m-1 md:m-8 border border-edge">
      <BrightJoins />
      <BrightJoinsProgressMeter progress={progress()} />

      <header
        class="flex max-md:flex-col w-full items-center gap-8"
        classList={{
          'justify-between': authenticatedState().type !== 'authenticated',
        }}
      >
        <div class="w-40">
          <MacroLogo class="fill-ink-muted" />
        </div>

        <Show when={authenticatedState().type !== 'authenticated'}>
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
              disabled:
                authenticatedState().type !== 'authenticated' ||
                checkoutState().type === 'loading',
              completed: checkoutState().type === 'finished',
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
