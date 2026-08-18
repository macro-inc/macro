import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
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
import { usePipedreamConnectionsQuery } from '@queries/pipedream-connectors';
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
import type { ModuleLogo, ModuleState } from '../Module';
import { MODULE_LOGOS } from '../moduleLogos';
import { BrandHandoff, type BrandHandoffSource } from './BrandHandoff';
import { BuildingStep, type ConnectedTools } from './BuildingStep';
import { ConnectorStep } from './ConnectorStep';
import { createFlowFinish } from './createFlowFinish';
import { EmailStep } from './EmailStep';
import {
  ONBOARDING_CONNECTORS_FEATURE_FLAG,
  type OnboardingConnectorServerName,
  resolveOnboardingConnectorNames,
  resolveOnboardingStepIndex,
} from './onboardingConnectorConfig';
import { PlanStep } from './PlanStep';
import { connectorLogo, StepModule } from './StepModule';
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

/** The left-of-title hero module for a connection step (desktop only). Its
 *  `linked` state is resolved from the flow's live queries by key: `email`
 *  from the email links, `connector` from the named MCP server's auth. */
type StepModuleDef =
  | { kind: 'email'; logo: ModuleLogo }
  | { kind: 'connector'; serverName: string; logo: ModuleLogo };

interface StepDef {
  key: string;
  /** Header title; omitted for chromeless steps (the building screen). */
  title?: string;
  subtitle?: string;
  /** Widens the column (the plan grid and the summary cards need room). */
  wide?: boolean;
  /** Excluded from the progress dots (transitions, not stops). */
  noDot?: boolean;
  /** Skip the Stepper's enter/exit fade+scale for this step. The building
   *  step needs this: the brand-handoff overlay it mounts is measured
   *  against its own logo's exact rect, and a fading exit would leave the
   *  original visible (transitioning) at the same time as the overlay. */
  noTransition?: boolean;
  /** Hero module shown left of the title on connection steps. */
  module?: StepModuleDef;
  render: (controls: StepControls) => JSX.Element;
}

interface StepControls {
  /** Advance after finishing the step (tracked as completed). */
  next: () => void;
  /** Advance without finishing the step (tracked as skipped). */
  skip: () => void;
  finishing: () => boolean;
  finishFree: (planSkipped: boolean) => void;
  /** Redirect to Stripe checkout without completing the flow. */
  startPremiumCheckout: (tier: 'premium') => void;
  /** Finish after checkout confirmed payment (or an existing license). */
  finishPremium: () => void;
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

function buildSteps(
  connectorNames: readonly OnboardingConnectorServerName[],
  connectedTools: () => ConnectedTools,
  onBuildingDone: (source: BrandHandoffSource | null) => void
): StepDef[] {
  const connectorSteps: StepDef[] = connectorNames.flatMap((name) => {
    const server = FEATURED_MCP_SERVERS.find(
      (candidate) => candidate.server_name === name
    );
    const copy = CONNECTOR_COPY[name];
    if (!server || !copy) return [];
    const logo = connectorLogo(name);
    return [
      {
        key: `connect-${name.toLowerCase()}`,
        title: `Connect ${name}`,
        subtitle: copy.subtitle,
        ...(logo && {
          module: { kind: 'connector', serverName: name, logo },
        }),
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
      module: { kind: 'email', logo: MODULE_LOGOS.Google },
      render: (controls) => (
        <EmailStep onContinue={controls.next} onSkip={controls.skip} />
      ),
    },
    ...connectorSteps,
    {
      key: 'team',
      title: 'Macro is meant for teams',
      subtitle:
        'Macro is built to be used with others. Invite your team to share docs, channels, and context from day one.',
      render: (controls) => (
        <TeamStep onContinue={controls.next} onSkip={controls.skip} />
      ),
    },
    {
      // Pure theater while gathers land; auto-advances into the summary via
      // the brand handoff (not a plain step advance).
      key: 'building',
      noDot: true,
      // Room for the isometric scene.
      wide: true,
      // See StepDef.noTransition.
      noTransition: true,
      render: () => (
        <BuildingStep connected={connectedTools()} onDone={onBuildingDone} />
      ),
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
          onStartCheckout={controls.startPremiumCheckout}
          onPremiumPaid={controls.finishPremium}
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
  const pipedreamQuery = usePipedreamConnectionsQuery({ neverSuspend: true });
  const analytics = useAnalytics();

  // Live connection state, derived from the flow's queries (no standing
  // bookkeeping): whether an MCP server authenticated, and which tools the
  // user connected. Drives the hero-module states and the build phrases.
  // Mirrors the backend's stack-selection rule (`mcp_select`): a user with
  // any Pipedream connectors is served those, so native rows stop counting.
  const serverAuthed = (name: string) => {
    const pipedream = pipedreamQuery.data ?? [];
    if (pipedream.length > 0) {
      return pipedream.some(
        (connection) =>
          connection.server_name.toLowerCase() === name.toLowerCase()
      );
    }
    return (serversQuery.data ?? []).some(
      (server) => server.server_name === name && server.authenticated
    );
  };
  const connectedTools = (): ConnectedTools => ({
    google: (linksQuery.data?.links.length ?? 0) > 0,
    linear: serverAuthed('Linear'),
    notion: serverAuthed('Notion'),
    slack: serverAuthed('Slack'),
    github: serverAuthed('GitHub'),
  });

  // The building → summary brand handoff. BuildingStep provides the exact
  // powered SVG plus its logo geometry; the overlay carries that scene into
  // the summary header while dissolving it into the flat Macro logo.
  const [handoff, setHandoff] = createSignal<BrandHandoffSource | null>(null);
  // Summary reveal gates: the logo slot + rest of the content appear once the
  // handoff lands. Default shown, for a summary reached without a handoff
  // (e.g. a restored step).
  const [logoShown, setLogoShown] = createSignal(true);
  const [contentShown, setContentShown] = createSignal(true);
  const summaryContentHidden = () =>
    currentStep().key === 'summary' && !contentShown();
  // Hiding must be instant, revealing eased. The header/body wrappers are
  // shared across steps, so a symmetric transition would animate 1 → 0 as we
  // enter the summary — the content visibly flashing in and fading out behind
  // the travelling logo.
  const contentFadeMs = () => (summaryContentHidden() ? 0 : 300);
  const startBrandHandoff = (source: BrandHandoffSource | null) => {
    if (!source) {
      advance('completed');
      return;
    }
    setHandoff(source);
    // Hide the summary's own content so only the settling logo shows.
    setLogoShown(false);
    setContentShown(false);
    advance('completed');
  };

  const connectorConfig = useFeatureFlag(ONBOARDING_CONNECTORS_FEATURE_FLAG);
  const steps = createMemo(() => {
    const config = connectorConfig();
    return buildSteps(
      resolveOnboardingConnectorNames(config.enabled, config.payload),
      connectedTools,
      startBrandHandoff
    );
  });

  const [activeStepKey, setActiveStepKey] = createSignal('email');
  const stepIndex = createMemo(() =>
    resolveOnboardingStepIndex(
      steps().map((step) => step.key),
      activeStepKey()
    )
  );
  const currentStep = createMemo(() => steps()[stepIndex()]);
  const currentStepKey = createMemo(() => currentStep().key);
  const userId = () => userInfoQuery.data?.userId;

  // The current step's hero-module state: the email module lights once any
  // inbox is linked, a connector's once its server authenticates.
  const heroState = (): ModuleState => {
    const mod = currentStep().module;
    if (!mod) return 'idle';
    if (mod.kind === 'email') {
      return (linksQuery.data?.links.length ?? 0) > 0 ? 'linked' : 'idle';
    }
    return serverAuthed(mod.serverName) ? 'linked' : 'idle';
  };

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
      setActiveStepKey(saved.step ?? 'email');
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
      entry_step: currentStepKey(),
    });
  });

  createEffect(() => {
    if (!needsOnboarding()) return;
    analytics.track('onboarding_v4_step', {
      step: currentStepKey(),
      index: stepIndex(),
      state: 'viewed',
    });
  });

  // Forward-only: there is no back.
  const advance = (state: 'completed' | 'skipped') => {
    analytics.track('onboarding_v4_step', {
      step: currentStepKey(),
      index: stepIndex(),
      state,
    });
    const index = Math.min(stepIndex() + 1, steps().length - 1);
    const nextStep = steps()[index];
    setActiveStepKey(nextStep.key);
    sessionStorage.setItem(
      FLOW_STEP_STORAGE_KEY,
      JSON.stringify({ user: userId(), step: nextStep.key })
    );
  };

  const finish = createFlowFinish({
    completionRollup: () => ({
      emails_connected: linksQuery.data?.links.length ?? 0,
      connectors_connected: (pipedreamQuery.data ?? []).length
        ? (pipedreamQuery.data ?? []).map((connection) =>
            connection.server_name.toLowerCase()
          )
        : (serversQuery.data ?? [])
            .filter((server) => server.authenticated)
            .map((server) => server.server_name.toLowerCase()),
    }),
  });
  const controls: StepControls = {
    next: () => advance('completed'),
    skip: () => advance('skipped'),
    finishing: finish.finishing,
    finishFree: (planSkipped) => void finish.finishFree(planSkipped),
    startPremiumCheckout: (tier) => void finish.startPremiumCheckout(tier),
    finishPremium: () => void finish.finishPremium(),
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
    <div class="relative size-full overflow-hidden bg-surface font-sans text-ink">
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

      {/* The backdrop layers are viewport-sized absolutes, so scrolling has
          to happen inside them — a tall step (the summary's pill cloud)
          would otherwise scroll the wash and grain away with the content,
          and the grain's 100vw width would add a horizontal scrollbar. */}
      <div class="relative z-10 size-full overflow-y-auto overscroll-contain">
        <div class="flex min-h-full items-center justify-center px-6 py-12">
          <div
            class={cn(
              'w-full obf-card transition-[max-width] duration-300',
              currentStep().wide ? 'sm:max-w-xl' : 'sm:max-w-lg'
            )}
          >
            <div class="flex flex-col gap-8">
              <Show when={currentStep().title}>
                <div class="flex flex-col gap-1.5">
                  {/* Hero module above the title — desktop only. Nudged left by
                      the module's built-in viewBox padding (reserved for the
                      click-burst trail) so its at-rest artwork left-aligns with
                      the title text. */}
                  <Show when={currentStep().module}>
                    {(mod) => (
                      <StepModule
                        logo={mod().logo}
                        state={heroState()}
                        class="mb-1 hidden size-32 -ml-8 sm:block"
                      />
                    )}
                  </Show>
                  {/* Landing slot for the loading-graphic → logo handoff. Kept
                      hidden while the overlay is mid-flight; the overlay lands
                      exactly here, then this static logo takes over. */}
                  <Show when={currentStep().key === 'summary'}>
                    <LogoIcon
                      id="summary-brand-logo"
                      class="mb-1 size-16 text-accent"
                      style={{ opacity: logoShown() ? 1 : 0 }}
                    />
                  </Show>
                  <div
                    class="flex flex-col gap-1.5 transition-opacity"
                    style={{
                      opacity: summaryContentHidden() ? 0 : 1,
                      'transition-duration': `${contentFadeMs()}ms`,
                    }}
                  >
                    <h1 class="text-2xl font-semibold tracking-tight text-ink">
                      {currentStep().title}
                    </h1>
                    <Show when={currentStep().subtitle}>
                      <p class="max-w-md text-sm leading-relaxed text-ink-muted">
                        {currentStep().subtitle}
                      </p>
                    </Show>
                  </div>
                </div>
              </Show>

              <div
                class="flex flex-col gap-8 transition-opacity"
                style={{
                  opacity: summaryContentHidden() ? 0 : 1,
                  'transition-duration': `${contentFadeMs()}ms`,
                }}
              >
                <Stepper
                  step={stepIndex()}
                  transition={Stepper.transitions.scale}
                >
                  <For each={steps()}>
                    {(step) => (
                      <Stepper.Step noTransition={step.noTransition}>
                        <Suspense fallback={<StepFallback />}>
                          {step.render(controls)}
                        </Suspense>
                      </Stepper.Step>
                    )}
                  </For>
                </Stepper>

                <Show when={!currentStep().noDot}>
                  <div class="flex gap-1.5">
                    <Index each={steps().filter((step) => !step.noDot)}>
                      {(step) => (
                        <div
                          class={cn(
                            'size-1.5 rounded-full transition-colors',
                            stepIndex() === steps().indexOf(step())
                              ? 'bg-accent'
                              : stepIndex() > steps().indexOf(step())
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
      </div>

      {/* Brand handoff overlay — rendered outside the animated card (a
          transformed ancestor would break its fixed positioning). */}
      <Show when={handoff()}>
        {(active) => (
          <BrandHandoff
            scene={active().scene}
            logo={active().logo}
            snapshot={active().snapshot}
            targetSelector="#summary-brand-logo"
            onDone={() => {
              setLogoShown(true);
              setContentShown(true);
              setHandoff(null);
            }}
          />
        )}
      </Show>
    </div>
  );
}
