import { useAnalytics } from '@app/component/analytics-context';
import { useSplitPanel } from '@app/component/split-layout/layoutUtils';
import { analytics } from '@app/lib/analytics/analytics';
import { useIsAuthenticated } from '@core/auth';
import { PcNoiseGrid } from '@core/component/PcNoiseGrid';
import { toast } from '@core/component/Toast/Toast';
import { useUserInfo } from '@core/context/user';
import { initAndStartEmailSync } from '@core/email-link';
import { fetchToken } from '@core/util/fetchWithToken';
import { throwOnErr } from '@core/util/result';
import ArrowLeftIcon from '@phosphor/arrow-left.svg';
import { useCompleteTutorialMutation } from '@queries/auth/tutorial';
import { invalidateUserTeams, useUserTeamsQuery } from '@queries/team';
import { authServiceClient } from '@service-auth/client';
import { useLocation, useNavigate } from '@solidjs/router';
import { useQuery } from '@tanstack/solid-query';
import { Button, cn, Layer, LogoProgress } from '@ui';
import { Stepper } from '@ui/components/Stepper';
import { createEffect, createMemo, For, on, onMount, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  clearPendingTeam,
  getPendingTeam,
} from '../interactive-onboarding/use-onboarding-checkout';
import { OnboardingProvider, useOnboarding } from './onboarding-context';
import { STEPS } from './steps';

export default function Onboarding() {
  return (
    <OnboardingProvider steps={STEPS}>
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
  const isAuthenticated = useIsAuthenticated();
  const userInfo = useUserInfo();
  const userTeamsQuery = useUserTeamsQuery();

  const params = new URLSearchParams(location.search);

  // Restore locally saved profile data (survives Google/Stripe redirects)
  const saved = sessionStorage.getItem('onboarding_profile');
  if (saved) {
    try {
      const profile = JSON.parse(saved);
      if (profile.firstName) ctx.setFirstName(profile.firstName);
      if (profile.lastName) ctx.setLastName(profile.lastName);
      if (profile.email) ctx.setEmail(profile.email);
      if (profile.teamName) ctx.setTeamName(profile.teamName);
    } catch {
      // ignore malformed data
    }
    sessionStorage.removeItem('onboarding_profile');
  }

  // Fill remaining gaps from authenticated user data
  createEffect(() => {
    if (!isAuthenticated()) return;

    ctx.skipStep('verify');

    const info = userInfo();
    if (!info) return;

    if (info.email && !ctx.email()) ctx.setEmail(info.email);
  });

  // Fetch first/last name separately (userInfo only has a combined display name)
  const userNameQuery = useQuery(() => ({
    queryKey: ['userName'],
    queryFn: async () => {
      const result = await authServiceClient.getUserName();
      if (result.isErr()) return null;
      return result.value;
    },
    enabled: isAuthenticated() === true && !ctx.firstName() && !ctx.lastName(),
  }));

  createEffect(() => {
    const name = userNameQuery.data;
    if (!name) return;
    if (name.first_name && !ctx.firstName()) ctx.setFirstName(name.first_name);
    if (name.last_name && !ctx.lastName()) ctx.setLastName(name.last_name);
  });

  // Prefill team name and skip team step if user already has a team
  createEffect(() => {
    const teams = userTeamsQuery.data;
    if (!teams) return;

    if (teams.length > 0) {
      const team = teams[0];
      if (team.name && !ctx.teamName()) ctx.setTeamName(team.name);
      ctx.skipStep('team');
    }
  });

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
      ctx.skipStep('verify');

      fetchToken().then(async () => {
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

        if (ctx.firstName() || ctx.lastName()) {
          authServiceClient
            .putUserName({
              first_name: ctx.firstName() || undefined,
              last_name: ctx.lastName() || undefined,
            })
            .catch(() => {});
        }
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

  // Exclude intro (index 0) and skipped steps from progress count
  const activeStepCount = createMemo(
    () => ctx.steps.filter((s, i) => i > 0 && s.status !== 'skipped').length
  );

  const activeStepPosition = createMemo(() => {
    const current = ctx.step();
    let pos = 0;
    for (let i = 1; i < ctx.steps.length; i++) {
      if (ctx.steps[i]?.status === 'skipped') continue;
      pos++;
      if (i === current) return pos;
    }
    return pos;
  });

  return (
    <div class="flex items-center justify-center size-full relative overflow-y-auto py-8">
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
            'w-full flex flex-col px-8',
            ctx.step() === 0 ? 'max-w-3xl' : 'max-w-md'
          )}
        >
          <Show when={ctx.step() > 0}>
            <div class="w-full flex items-center gap-3 mb-10">
              <LogoProgress
                level={activeStepPosition()}
                total={activeStepCount()}
                class="w-7"
              />
              <Show when={activeStepCount() > 1}>
                <span class="text-xs font-mono text-ink-disabled">
                  {activeStepPosition()}/{activeStepCount()}
                </span>
              </Show>
            </div>
          </Show>

          <div class="w-full flex flex-col gap-2">
            <Show when={ctx.step() > 0}>
              <div class={showBack() ? 'visible' : 'invisible'}>
                <button
                  type="button"
                  tabIndex={0}
                  onClick={() => ctx.back()}
                  class="flex items-center gap-1 text-xs text-ink-disabled hover:text-ink transition-colors outline-none rounded-sm focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-surface"
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
              class={cn(
                'overflow-clip p-1 -m-1',
                ctx.step() > 0 && 'min-h-125'
              )}
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
      try {
        await throwOnErr(() => authServiceClient.inviteToTeam({ invites }));
      } catch (inviteError) {
        console.error('Failed to send team invites:', inviteError);
        toast.failure('Team created, but some invites failed to send.');
      }
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
    toast.failure(
      'Failed to create team. You can set it up later in Settings.'
    );
    clearPendingTeam();
    return false;
  }
}
