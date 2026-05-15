import { useAnalytics } from '@app/component/analytics-context';
import { analytics } from '@app/lib/analytics/analytics';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { initAndStartEmailSync } from '@core/email-link';
import { PcNoiseGrid } from '@core/component/PcNoiseGrid';
import { ENABLE_NEW_ONBOARDING_OVERRIDE } from '@core/constant/featureFlags';
import { useSplitPanel } from '@app/component/split-layout/layoutUtils';
import { useCompleteTutorialMutation } from '@queries/auth/tutorial';
import { invalidateUserTeams } from '@queries/team';
import { authServiceClient } from '@service-auth/client';
import { throwOnErr } from '@core/util/maybeResult';
import { fetchToken } from '@core/util/fetchWithToken';
import LogoIcon from '@macro-icons/macro-logo.svg';
import ArrowLeftIcon from '@icon/regular/arrow-left.svg';
import { useLocation, useNavigate } from '@solidjs/router';
import { Button, cn, Layer } from '@ui';
import {
  createEffect,
  lazy,
  Match,
  on,
  onMount,
  Show,
  Suspense,
  Switch,
} from 'solid-js';
import {
  clearPendingTeam,
  getPendingTeam,
} from '../interactive-onboarding/use-onboarding-checkout';
import { OnboardingProvider, useOnboarding } from './onboarding-context';
import { IntroStep, PaymentStep, ProfileStep, TeamStep } from './steps';

const OldOnboarding = lazy(
  () => import('../interactive-onboarding/InteractiveOnboarding')
);

const STEP_LABELS = ['Intro', 'Profile', 'Team', 'Payment'];

export default function Onboarding() {
  const flag = useFeatureFlag('enable-new-onboarding', {
    enabledOverride: ENABLE_NEW_ONBOARDING_OVERRIDE,
  });

  return (
    <Suspense>
      <Show when={flag().enabled} fallback={<OldOnboarding />}>
        <OnboardingProvider>
          <OnboardingInner />
        </OnboardingProvider>
      </Show>
    </Suspense>
  );
}

function OnboardingInner() {
  const ctx = useOnboarding();
  const analyticsCtx = useAnalytics();
  const location = useLocation();
  const navigate = useNavigate();
  const splitPanel = useSplitPanel();
  const completeTutorial = useCompleteTutorialMutation();

  const params = new URLSearchParams(location.search);

  const navigateAway = () => {
    if (splitPanel) {
      splitPanel.handle.replace({
        next: { type: 'component', id: 'unified-list' },
      });
    } else {
      navigate('/', { replace: true });
    }
  };

  onMount(() => {
    if (params.has('google')) {
      const cleanParams = new URLSearchParams(window.location.search);
      cleanParams.delete('google');
      const qs = cleanParams.toString();
      window.history.replaceState(
        null,
        '',
        qs ? `${window.location.pathname}?${qs}` : window.location.pathname
      );

      fetchToken().then(() => {
        initAndStartEmailSync().match(
          () => analytics.track('email_authorized'),
          (e) => {
            if (e.tag === 'AlreadyInitialized') {
              analytics.track('email_authorized');
            } else {
              console.error('Failed to init email link after Google auth', e);
            }
          }
        );
      });

      ctx.setStep(2);
    }
  });

  onMount(() => {
    if (params.has('subscriptionSuccess')) {
      const cleanParams = new URLSearchParams(window.location.search);
      const rawTier = cleanParams.get('type');
      cleanParams.delete('subscriptionSuccess');
      cleanParams.delete('type');
      const qs = cleanParams.toString();
      window.history.replaceState(
        null,
        '',
        qs ? `${window.location.pathname}?${qs}` : window.location.pathname
      );

      analytics.track('subscription_success', { type: rawTier ?? 'unknown' });
      fetchToken().then(() => createPendingTeamOnReturn());
      completeTutorial.mutate(undefined);
      navigateAway();
    }
  });

  onMount(() => {
    analyticsCtx.track('onboarding_start');
  });

  createEffect(
    on(
      () => ctx.step(),
      (step) => {
        analyticsCtx.track('onboarding_step', {
          step,
          label: STEP_LABELS[step],
        });
      }
    )
  );

  const showBack = () => ctx.step() > 1;

  return (
    <div class="flex items-center justify-center size-full overflow-hidden relative">
      <style>
        {`
        @keyframes onb-enter {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        input:-webkit-autofill,
        input:-webkit-autofill:hover,
        input:-webkit-autofill:focus {
          -webkit-box-shadow: 0 0 0 1000px var(--color-surface) inset;
          -webkit-text-fill-color: var(--color-ink);
          caret-color: var(--color-ink);
          transition: background-color 5000s ease-in-out 0s;
        }
        `}
      </style>

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

      <Layer depth={3}>
        <div
          class={cn(
            'w-full flex flex-col items-center px-8',
            ctx.step() === 0 ? 'max-w-3xl' : 'max-w-md'
          )}
        >
          {/* Header */}
          <Show when={ctx.step() > 0}>
            <div class="w-full flex items-center justify-between mb-10">
              <Show
                when={showBack()}
                fallback={<LogoIcon class="size-5 text-accent" />}
              >
                <Button variant="ghost" size="sm" onClick={() => ctx.back()}>
                  <ArrowLeftIcon class="size-4" />
                  Back
                </Button>
              </Show>
              <div class="flex items-center gap-3">
                <StepIndicator
                  current={ctx.step() - 1}
                  total={STEP_LABELS.length - 1}
                />
                <Show when={import.meta.env.MODE === 'development'}>
                  <Button variant="ghost" size="sm" onClick={() => ctx.next()}>
                    Skip
                  </Button>
                </Show>
              </div>
            </div>
          </Show>

          {/* Content */}
          <div
            class="w-full"
            style={{
              animation: 'onb-enter 400ms cubic-bezier(0.16, 1, 0.3, 1) both',
              'animation-delay': '50ms',
              '--onboarding-key': String(ctx.step()),
            }}
          >
            <Switch>
              <Match when={ctx.step() === 0}>
                <IntroStep />
              </Match>
              <Match when={ctx.step() === 1}>
                <ProfileStep />
              </Match>
              <Match when={ctx.step() === 2}>
                <TeamStep />
              </Match>
              <Match when={ctx.step() === 3}>
                <PaymentStep />
              </Match>
            </Switch>
          </div>
        </div>
      </Layer>
    </div>
  );
}

function StepIndicator(props: { current: number; total: number }) {
  return (
    <div class="flex items-center gap-1.5">
      {Array.from({ length: props.total }, (_, i) => (
        <div
          class={cn(
            'h-1.5 rounded-full transition-all duration-200',
            i === props.current
              ? 'w-6 bg-accent'
              : i < props.current
                ? 'w-1.5 bg-accent/40'
                : 'w-1.5 bg-edge'
          )}
        />
      ))}
    </div>
  );
}

async function createPendingTeamOnReturn(): Promise<boolean> {
  const pendingTeam = getPendingTeam();
  if (!pendingTeam) return true;

  try {
    const team = await throwOnErr(() =>
      authServiceClient.createTeam({ name: pendingTeam.name })
    );

    const invites = pendingTeam.members
      .filter((m) => m.email.trim())
      .map((m) => ({ email: m.email }));

    if (invites.length > 0) {
      await throwOnErr(() => authServiceClient.inviteToTeam({ invites }));
    }

    await invalidateUserTeams();
    clearPendingTeam();

    analytics.track('onboarding_team_created', {
      inviteCount: invites.length,
      teamId: team.id,
    });

    return true;
  } catch (error) {
    console.error('Failed to create team:', error);
    clearPendingTeam();
    return true;
  }
}
