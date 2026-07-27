import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { FEATURED_MCP_SERVERS } from '@core/component/AI/constant/mcpServers';
import LogoIcon from '@icon/macro-logo.svg';
import { authKeys } from '@queries/auth/keys';
import { useCompleteTutorialMutation } from '@queries/auth/tutorial';
import { useUserInfoQuery } from '@queries/auth/user-info';
import { queryClient } from '@queries/client';
import { useEmailLinksQuery } from '@queries/email/link';
import { useImportQuery } from '@queries/import';
import { useMcpServersQuery } from '@queries/mcp-servers';
import { useOnboardingQuery } from '@queries/onboarding';
import { useNavigate } from '@solidjs/router';
import { cn } from '@ui';
import { Stepper } from '@ui/components/Stepper';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Index,
  type JSX,
  Show,
  Suspense,
} from 'solid-js';
import { BuildingStep } from './BuildingStep';
import { ConnectorStep } from './ConnectorStep';
import { createFlowFinish } from './createFlowFinish';
import { EmailStep } from './EmailStep';
import { PlanStep } from './PlanStep';
import { SummaryStep } from './SummaryStep';
import {
  FLOW_NEXT_STORAGE_KEY,
  FLOW_STEP_STORAGE_KEY,
  NoiseBackground,
} from './shared';
import { TeamStep } from './TeamStep';

/**
 * The full-screen onboarding flow new users land in after signup (desktop
 * `/onboarding`, also rendered in place on /login). Forward-only with
 * per-step skips; the server orchestrates imports (reads of an active
 * onboarding start due gather runs with auto-import). Finishing the last
 * step marks onboarding complete.
 */

interface StepDef {
  key: string;
  /** Header title; omitted for chromeless steps (the building screen). */
  title?: string;
  subtitle?: string;
  /** Widens the column (the plan grid and the summary cards need room). */
  wide?: boolean;
  /** Excluded from the progress dots (transitions, not stops). */
  noDot?: boolean;
  render: (controls: StepControls) => JSX.Element;
}

interface StepControls {
  /** Advance after finishing the step (tracked as completed). */
  next: () => void;
  /** Advance without finishing the step (tracked as skipped). */
  skip: () => void;
  finishing: () => boolean;
  finishFree: (planSkipped: boolean) => void;
  finishPremium: (tier: 'premium') => void;
}

interface ConnectorStepCopy {
  subtitle: string;
  features: string[];
  /** Shown under the row once connected — what happens behind the scenes. */
  gatherHint?: string;
}

const CONNECTOR_COPY: Record<string, ConnectorStepCopy> = {
  Linear: {
    subtitle: 'Bring your issues into your unified workspace.',
    features: [
      'Macro imports a small set of your recent issues and tags as Macro tasks, ready to work on.',
      'Macro AI can create, read, and update Linear issues without leaving Macro.',
    ],
    gatherHint:
      "We're already looking through your Linear — you'll see what we found before you finish.",
  },
  Notion: {
    subtitle: 'Bring your docs and wikis into your unified workspace.',
    features: [
      'Macro imports a small set of your pages as Macro docs.',
      'Macro AI can search your pages and wikis.',
    ],
    gatherHint:
      "We're already looking through your Notion — you'll see what we found before you finish.",
  },
  Slack: {
    subtitle: 'Bring your conversations into your unified workspace.',
    features: [
      'Macro creates channels based on your existing Slack channels, with the right participants.',
      'Macro AI can search conversations and post updates for you.',
    ],
    gatherHint:
      "We're already looking through your Slack — you'll see what we found before you finish.",
  },
  GitHub: {
    subtitle: 'Bring your repos into your unified workspace.',
    features: [
      'Pull requests show up in Macro.',
      'Tasks get auto-updating branch names.',
      'Macro AI can answer questions about your repos, pull requests, and issues.',
    ],
  },
};

/** Connector steps, in spec order, dropping tools absent from this build
 * (Slack is dev-only in production FEATURED_MCP_SERVERS). */
const CONNECTOR_STEP_NAMES = ['Linear', 'Notion', 'Slack', 'GitHub'];

function buildSteps(): StepDef[] {
  const connectorSteps: StepDef[] = CONNECTOR_STEP_NAMES.flatMap((name) => {
    const server = FEATURED_MCP_SERVERS.find(
      (candidate) => candidate.server_name === name
    );
    const copy = CONNECTOR_COPY[name];
    if (!server || !copy) return [];
    return [
      {
        key: `connect-${name.toLowerCase()}`,
        title: `Connect ${name}`,
        subtitle: copy.subtitle,
        render: (controls: StepControls) => (
          <ConnectorStep
            server={server}
            features={copy.features}
            gatherHint={copy.gatherHint}
            onContinue={controls.next}
            onSkip={controls.skip}
          />
        ),
      },
    ];
  });

  return [
    {
      key: 'email',
      title: 'Connect your Google accounts',
      subtitle:
        'Macro builds one unified memory across everything you do. Connecting multiple email accounts brings your email, docs, and calendar together, so nothing lives in a silo.',
      render: (controls) => (
        <EmailStep onContinue={controls.next} onSkip={controls.skip} />
      ),
    },
    ...connectorSteps,
    {
      key: 'team',
      title: 'Set up your team',
      subtitle:
        'Macro is built to be used with others. Invite your team to share docs, channels, and context from day one.',
      render: (controls) => (
        <TeamStep onContinue={controls.next} onSkip={controls.skip} />
      ),
    },
    {
      // Pure theater while gathers land; auto-advances into the summary.
      key: 'building',
      noDot: true,
      render: (controls) => <BuildingStep onDone={controls.next} />,
    },
    {
      key: 'summary',
      title: 'Your workspace is taking shape',
      subtitle:
        "Here's what we're bringing into Macro. Imports keep running in the background — no need to wait.",
      wide: true,
      render: (controls) => <SummaryStep onContinue={controls.next} />,
    },
    {
      key: 'plan',
      title: 'Choose your plan',
      subtitle: 'Start free, or go Premium. You can change this anytime.',
      wide: true,
      render: (controls) => (
        <PlanStep
          finishing={controls.finishing()}
          onFree={controls.finishFree}
          onPremium={controls.finishPremium}
        />
      ),
    },
  ];
}

/** Quiet placeholder while a step's first-load queries resolve. */
function StepFallback() {
  return (
    <div class="flex justify-center py-10">
      <LogoIcon class="size-6 animate-pulse text-ink/30" />
    </div>
  );
}

export function OnboardingFlow() {
  // Own boundary: a query suspending here would otherwise blank the whole
  // app through the root <Suspense>.
  return (
    <Suspense
      fallback={
        <div class="flex h-full w-full items-center justify-center bg-surface">
          <LogoIcon class="size-8 animate-pulse text-accent" />
        </div>
      }
    >
      <FlowContent />
    </Suspense>
  );
}

function FlowContent() {
  const navigate = useNavigate();
  const userInfoQuery = useUserInfoQuery();
  // Reading the onboarding state creates the flow's row and starts gather
  // runs — it must never fire for someone who already onboarded.
  const needsOnboarding = () =>
    userInfoQuery.data?.authenticated === true &&
    userInfoQuery.data.tutorialComplete === false;
  const onboardingQuery = useOnboardingQuery({ enabled: needsOnboarding });
  // Mounted for the whole flow so gather results are warm by the summary.
  useImportQuery({ enabled: needsOnboarding });
  // Analytics inputs; read only from handlers/effects so they never
  // suspend this boundary.
  const linksQuery = useEmailLinksQuery();
  const serversQuery = useMcpServersQuery({ neverSuspend: true });
  const analytics = useAnalytics();

  const steps = buildSteps();

  const [stepIndex, setStepIndex] = createSignal(0);
  const currentStep = createMemo(() => steps[stepIndex()]);
  const userId = () => userInfoQuery.data?.userId;

  // Resume where a full-page OAuth round-trip left off — only for the user
  // who saved the step: sessionStorage is per-tab, and a different account
  // logging in on the same tab must not inherit the previous user's step.
  let restored = false;
  createEffect(() => {
    const uid = userId();
    if (restored || !uid) return;
    restored = true;
    try {
      const raw = sessionStorage.getItem(FLOW_STEP_STORAGE_KEY);
      if (!raw) return;
      const saved: { user?: string; step?: string } = JSON.parse(raw);
      if (saved.user !== uid) {
        sessionStorage.removeItem(FLOW_STEP_STORAGE_KEY);
        sessionStorage.removeItem(FLOW_NEXT_STORAGE_KEY);
        return;
      }
      const index = steps.findIndex((step) => step.key === saved.step);
      if (index !== -1) setStepIndex(index);
    } catch {
      sessionStorage.removeItem(FLOW_STEP_STORAGE_KEY);
    }
  });

  // A Google SSO signup arrives with its Gmail inbox already linked, an
  // email-code signup with none — the first links payload is the signal.
  let startedTracked = false;
  createEffect(() => {
    if (startedTracked || !needsOnboarding()) return;
    const links = linksQuery.data?.links;
    if (!links) return;
    startedTracked = true;
    analytics.track('onboarding_v4_started', {
      signup_method: links.length > 0 ? 'google' : 'email_code',
      entry_step: currentStep().key,
    });
  });

  createEffect(() => {
    if (!needsOnboarding()) return;
    analytics.track('onboarding_v4_step', {
      step: currentStep().key,
      index: stepIndex(),
      state: 'viewed',
    });
  });

  // Forward-only: there is no back.
  const advance = (state: 'completed' | 'skipped') => {
    analytics.track('onboarding_v4_step', {
      step: currentStep().key,
      index: stepIndex(),
      state,
    });
    const index = Math.min(stepIndex() + 1, steps.length - 1);
    setStepIndex(index);
    sessionStorage.setItem(
      FLOW_STEP_STORAGE_KEY,
      JSON.stringify({ user: userId(), step: steps[index].key })
    );
  };

  const finish = createFlowFinish({
    completionRollup: () => ({
      emails_connected: linksQuery.data?.links.length ?? 0,
      connectors_connected: (serversQuery.data ?? [])
        .filter((server) => server.authenticated)
        .map((server) => server.server_name.toLowerCase()),
    }),
  });
  const controls: StepControls = {
    next: () => advance('completed'),
    skip: () => advance('skipped'),
    finishing: finish.finishing,
    finishFree: (planSkipped) => void finish.finishFree(planSkipped),
    finishPremium: (tier) => void finish.finishPremium(tier),
  };

  // Heal a half-landed finish: NewOnboardingRedirect keys off
  // tutorialComplete while this flow keys off the onboarding row, and the
  // two are not completed atomically — row completed + flag stuck false
  // would ping-pong between Layout and this flow forever.
  const completeTutorial = useCompleteTutorialMutation();
  const [healingTutorial, setHealingTutorial] = createSignal(false);
  const healTutorial = () => {
    if (healingTutorial()) return;
    setHealingTutorial(true);
    void completeTutorial
      .mutateAsync()
      .then(() =>
        queryClient.refetchQueries({ queryKey: authKeys.userInfo.queryKey })
      )
      .catch(() => {});
  };

  // Redirect out when there is nothing to onboard. finishing() guards the
  // window between our own complete call and the checkout redirect.
  createEffect(() => {
    const info = userInfoQuery.data;
    if (info?.authenticated === false) {
      navigate('/login', { replace: true });
      return;
    }
    if (finish.finishing() || info?.authenticated !== true) return;
    if (info.tutorialComplete !== false) {
      navigate(finish.afterTarget(), { replace: true });
      return;
    }
    if (onboardingQuery.data?.row.status === 'completed') {
      healTutorial();
    }
  });

  return (
    <div class="relative size-full overflow-y-auto bg-surface font-sans text-ink">
      <style>{
        /*css*/ `
        @keyframes obf-card-in {
          from { opacity: 0; transform: translateY(14px) scale(0.985); }
          to   { opacity: 1; transform: translateY(0)    scale(1);     }
        }
        .obf-card { animation: obf-card-in 520ms cubic-bezier(0.22, 1, 0.36, 1) both; }

        /* Override browser autofill yellow with our surface/ink palette */
        .obf-input:-webkit-autofill,
        .obf-input:-webkit-autofill:hover,
        .obf-input:-webkit-autofill:focus,
        .obf-input:-webkit-autofill:active {
          -webkit-box-shadow: 0 0 0 1000px var(--color-surface) inset;
          -webkit-text-fill-color: var(--color-ink);
          caret-color: var(--color-ink);
          transition: background-color 5000s ease-in-out 0s;
        }
      `
      }</style>

      <NoiseBackground />

      <div class="relative z-10 flex min-h-full items-center justify-center px-6 py-12">
        <div
          class={cn(
            'w-full obf-card transition-[max-width] duration-300',
            currentStep().wide ? 'sm:max-w-xl' : 'sm:max-w-lg'
          )}
        >
          <div class="flex flex-col gap-8">
            <Show when={currentStep().title}>
              <div class="flex flex-col gap-1.5">
                <h1 class="text-2xl font-semibold tracking-tight text-ink">
                  {currentStep().title}
                </h1>
                <Show when={currentStep().subtitle}>
                  <p class="max-w-md text-sm leading-relaxed text-ink-muted">
                    {currentStep().subtitle}
                  </p>
                </Show>
              </div>
            </Show>

            <Stepper step={stepIndex()} transition={Stepper.transitions.scale}>
              <For each={steps}>
                {(step) => (
                  <Stepper.Step>
                    {/* Per-step boundary: a first-load query suspending
                        inside the Stepper's Transition would drop the
                        entering node entirely. */}
                    <Suspense fallback={<StepFallback />}>
                      {step.render(controls)}
                    </Suspense>
                  </Stepper.Step>
                )}
              </For>
            </Stepper>

            <Show when={!currentStep().noDot}>
              <div class="flex gap-1.5">
                <Index each={steps.filter((step) => !step.noDot)}>
                  {(step) => (
                    <div
                      class={cn(
                        'size-1.5 rounded-full transition-colors',
                        stepIndex() === steps.indexOf(step())
                          ? 'bg-accent'
                          : stepIndex() > steps.indexOf(step())
                            ? 'bg-ink/40'
                            : 'bg-ink/15'
                      )}
                    />
                  )}
                </Index>
              </div>
            </Show>
          </div>
        </div>
      </div>
    </div>
  );
}
