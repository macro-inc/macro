import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { PcNoiseGrid } from '@core/component/PcNoiseGrid';
import { useIsAuthenticated } from '@core/context/user';
import LogoIcon from '@icon/macro-logo.svg';
import { useNavigate } from '@solidjs/router';
import { Button, Surface } from '@ui';
import { Stepper } from '@ui/components/Stepper';
import { createEffect, createSignal, onMount, Show } from 'solid-js';
import { OnboardingConnectAccounts } from './OnboardingConnectAccounts';
import { OnboardingCreateAccount } from './OnboardingCreateAccount';
import { OnboardingInbox } from './OnboardingInbox';

const CREATE_ACCOUNT_STEP = 0;
const LAST_STEP = 2;

/**
 * `Stepper.transitions.scale` uses solid-transition-group's `mode: 'outin'`,
 * which mounts the entering step only after the exiting step's transition emits
 * `transitionend`. When that event never arrives (e.g. the exit transition is
 * cancelled or runs instantly), the switch wedges: the old step is left frozen
 * at `opacity-0` and the next step never mounts — exactly the "blank step 2"
 * symptom. A simultaneous transition (no `mode`) mounts the entering step
 * immediately so it can't wedge; the exiting step is positioned absolutely so
 * the two overlap during the cross-fade, and `pointer-events-none` keeps a
 * lingering exit node from eating taps.
 */
const STEP_TRANSITION = {
  enterActiveClass: 'transition-all duration-200 ease-out',
  enterClass: 'opacity-0 scale-95',
  enterToClass: 'opacity-100 scale-100',
  exitActiveClass:
    'transition-all duration-150 ease-in absolute inset-0 pointer-events-none',
  exitClass: 'opacity-100 scale-100',
  exitToClass: 'opacity-0 scale-95',
};

/**
 * Native-mobile sign-up wizard: a logo-topped, Continue-footed pager that walks
 * a new user through creating an account, connecting their accounts, and info
 * panels. The first step has no Continue button — it auto-advances once the
 * user authenticates by connecting their primary Gmail.
 */
export function MobileOnboarding() {
  const [step, setStep] = createSignal(CREATE_ACCOUNT_STEP);
  const navigate = useNavigate();
  const analytics = useAnalytics();
  const isAuthenticated = useIsAuthenticated();

  onMount(() => {
    analytics.pageView('mobile_onboarding');
  });

  // The create-account step has no Continue button; advance to the connect step
  // as soon as the SSO sign-in flips the user to authenticated.
  createEffect(() => {
    if (step() === CREATE_ACCOUNT_STEP && isAuthenticated()) {
      setStep(CREATE_ACCOUNT_STEP + 1);
    }
  });

  const onContinue = () => {
    if (step() >= LAST_STEP) {
      navigate('/', { replace: true });
      return;
    }
    setStep(step() + 1);
  };

  return (
    <div class="relative flex size-full overflow-hidden px-4 pt-[calc(var(--safe-top)+2rem)] pb-[calc(var(--safe-bottom)+2rem)]">
      <div class="inset-0 absolute text-edge bg-surface opacity-10 -z-1">
        <PcNoiseGrid
          cellSize={30}
          warp={0}
          crunch={0.2}
          freq={0.001}
          size={[0, 0.3]}
          rounding={0}
          fill={0}
          stroke={1}
          speed={[0.017, 0.209]}
        />
      </div>

      <Surface depth={1} class="flex flex-col mt-(--mobile-content-inset-top)">
        <div class="flex shrink-0 items-center justify-center pt-8 pb-4">
          <LogoIcon class="size-16 text-ink" />
        </div>

        <div class="min-h-0 grow overflow-y-auto px-6">
          <div class="mx-auto w-full max-w-md h-full">
            <Stepper class="h-full" step={step()} transition={STEP_TRANSITION}>
              <Stepper.Step>
                <OnboardingCreateAccount />
              </Stepper.Step>
              <Stepper.Step>
                <OnboardingConnectAccounts />
              </Stepper.Step>
              <Stepper.Step>
                <OnboardingInbox />
              </Stepper.Step>
            </Stepper>
          </div>
        </div>

        <Show when={step() > CREATE_ACCOUNT_STEP}>
          <div class="mx-auto w-full max-w-md shrink-0 px-6 pt-6 pb-6">
            <Button
              variant="strong"
              size="xl"
              class="w-full"
              onClick={onContinue}
            >
              {step() >= LAST_STEP ? 'Get started' : 'Continue'}
            </Button>
          </div>
        </Show>
      </Surface>
    </div>
  );
}
