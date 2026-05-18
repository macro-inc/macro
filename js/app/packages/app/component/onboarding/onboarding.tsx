import { useAnalytics } from '@app/component/analytics-context';
import { useSplitPanel } from '@app/component/split-layout/layoutUtils';
import { analytics } from '@app/lib/analytics/analytics';
import { PcNoiseGrid } from '@core/component/PcNoiseGrid';
import { initAndStartEmailSync } from '@core/email-link';
import { fetchToken } from '@core/util/fetchWithToken';
import { throwOnErr } from '@core/util/maybeResult';
import ArrowLeftIcon from '@icon/regular/arrow-left.svg';
import { useCompleteTutorialMutation } from '@queries/auth/tutorial';
import { invalidateUserTeams } from '@queries/team';
import { authServiceClient } from '@service-auth/client';
import { useLocation, useNavigate } from '@solidjs/router';
import { Button, cn, Layer, LogoProgress, Stepper } from '@ui';
import { createEffect, For, on, onMount, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  clearPendingTeam,
  getPendingTeam,
} from '../interactive-onboarding/use-onboarding-checkout';
import { OnboardingProvider, useOnboarding } from './onboarding-context';
import { STEPS } from './steps';

export default function Onboarding() {
  return (
    <OnboardingProvider totalSteps={STEPS.length}>
      <OnboardingInner />
    </OnboardingProvider>
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

  const cleanParam = (key: string) => {
    const cleanParams = new URLSearchParams(window.location.search);
    cleanParams.delete(key);
    const qs = cleanParams.toString();
    window.history.replaceState(
      null,
      '',
      qs ? `${window.location.pathname}?${qs}` : window.location.pathname
    );
  };

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
      cleanParam('google');

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

      const teamStepIndex = STEPS.findIndex((s) => s.id === 'team');
      if (teamStepIndex !== -1) ctx.setStep(teamStepIndex);

      return;
    }

    if (params.has('subscriptionSuccess')) {
      const rawTier = params.get('type');

      cleanParam('subscriptionSuccess');
      cleanParam('type');

      analytics.track('subscription_success', { type: rawTier ?? 'unknown' });

      fetchToken().then(() => createPendingTeamOnReturn());
      completeTutorial.mutate(undefined);

      navigateAway();

      return;
    }

    analyticsCtx.track('onboarding_start');
  });

  createEffect(
    on(
      () => ctx.step(),
      (step) => {
        analyticsCtx.track('onboarding_step', {
          step,
          id: STEPS[step]?.id,
          label: STEPS[step]?.label,
        });
      }
    )
  );

  const showBack = () => ctx.step() > 1;

  return (
    <div class="flex items-center justify-center size-full relative">
      <style>
        {`
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
            'w-full flex flex-col justify-center px-8 min-h-1/2',
            ctx.step() === 0 ? 'max-w-3xl' : 'max-w-md'
          )}
        >
          <Show when={ctx.step() > 0}>
            <div class="w-full flex items-center gap-3 mb-10">
              <LogoProgress
                level={ctx.step()}
                total={STEPS.length - 1}
                class="w-7"
              />
              <span class="text-xs font-mono text-ink-disabled">
                {ctx.step()}/{STEPS.length - 1}
              </span>
            </div>
          </Show>

          <div class="w-full flex flex-col gap-2">
            <Show when={ctx.step() > 0}>
              <div class={showBack() ? 'visible' : 'invisible'}>
                <button
                  type="button"
                  onClick={() => ctx.back()}
                  class="flex items-center gap-1 text-xs text-ink-disabled hover:text-ink transition-colors outline-none"
                >
                  <ArrowLeftIcon class="size-3" />
                  Back
                </button>
              </div>
            </Show>
            <Stepper
              step={ctx.step()}
              transition={Stepper.transitions.slideFull}
              appear
              class="overflow-clip p-1 -m-1"
            >
              <For each={STEPS}>
                {(stepDef, i) => (
                  <Stepper.Step noTransition={i() === 0}>
                    <Dynamic component={stepDef.component} />
                  </Stepper.Step>
                )}
              </For>
            </Stepper>
          </div>
        </div>
      </Layer>

      <Show when={import.meta.env.MODE === 'development'}>
        <div class="fixed bottom-4 right-4 z-50">
          <Button variant="ghost" size="sm" onClick={() => ctx.next()}>
            Skip step
          </Button>
        </div>
      </Show>
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
