import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import LogoIcon from '@icon/macro-logo.svg';
import { authKeys } from '@queries/auth/keys';
import { useCompleteTutorialMutation } from '@queries/auth/tutorial';
import { useUserInfoQuery } from '@queries/auth/user-info';
import { queryClient } from '@queries/client';
import { useEmailLinksQuery } from '@queries/email/link';
import { useGtmInviteOfferQuery } from '@queries/gtm-invite/links';
import { useImportQuery } from '@queries/import';
import { useMcpServersQuery } from '@queries/mcp-servers';
import { useOnboardingQuery } from '@queries/onboarding';
import { usePipedreamConnectionsQuery } from '@queries/pipedream-connectors';
import type { GtmInviteOffer } from '@service-auth/generated/schemas/gtmInviteOffer';
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
import { OnboardingShell } from '../components/OnboardingShell';
import { isStoryStep, StoryStage } from '../components/StoryStage';
import { SecurityStep, VisionStep } from '../components/StorySteps';
import { WelcomeStep } from '../components/WelcomeSteps';
import type { ModuleLogo, ModuleState } from '../Module';
import { MODULE_LOGOS } from '../moduleLogos';
import { BrandHandoff, type BrandHandoffSource } from './BrandHandoff';
import { BuildingStep, type ConnectedTools } from './BuildingStep';
import { CustomizeStep } from './CustomizeStep';
import { createFlowFinish } from './createFlowFinish';
import { EmailStep } from './EmailStep';
import {
  ONBOARDING_CONNECTORS_FEATURE_FLAG,
  type OnboardingConnectorServerName,
  resolveOnboardingConnectorNames,
  resolveOnboardingStepIndex,
} from './onboardingConnectorConfig';
import { PlanStep } from './PlanStep';
import { StepModule } from './StepModule';
import { SummaryStep } from './SummaryStep';
import { FLOW_NEXT_STORAGE_KEY, FLOW_STEP_STORAGE_KEY } from './shared';
import { TeamStep } from './TeamStep';
import { ToolsStep } from './ToolsStep';

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
  /** The free-month promotion an invite-link signup holds, once known. */
  inviteOffer: () => GtmInviteOffer | null;
}

function buildSteps(
  connectorNames: readonly OnboardingConnectorServerName[],
  connectedTools: () => ConnectedTools,
  onBuildingDone: (source: BrandHandoffSource | null) => void
): StepDef[] {
  return [
    {
      key: 'welcome',
      wide: true,
      render: (controls) => <WelcomeStep onContinue={controls.next} />,
    },
    {
      key: 'vision',
      wide: true,
      render: (controls) => <VisionStep onContinue={controls.next} />,
    },
    {
      key: 'tools',
      wide: true,
      render: (controls) => (
        <ToolsStep
          connectorNames={connectorNames}
          onContinue={controls.next}
          onSkip={controls.skip}
        />
      ),
    },
    {
      key: 'security',
      wide: true,
      render: (controls) => <SecurityStep onContinue={controls.next} />,
    },
    {
      key: 'team',
      title: 'Better, together.',
      subtitle:
        'Macro is built to be used with others. Invite your team to share docs, channels, and context from day one.',
      render: (controls) => (
        <TeamStep onContinue={controls.next} onSkip={controls.skip} />
      ),
    },
    {
      key: 'email',
      title: 'Bring your inboxes together.',
      subtitle:
        'Work and personal. Side projects and big plans. Bring your Google email and calendar into one place.',
      module: { kind: 'email', logo: MODULE_LOGOS.Google },
      render: (controls) => (
        <EmailStep onContinue={controls.next} onSkip={controls.skip} />
      ),
    },
    {
      key: 'customize',
      title: 'Make room for your best work.',
      subtitle: 'A familiar space, with a fresh perspective.',
      wide: true,
      render: (controls) => <CustomizeStep onContinue={controls.next} />,
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
          inviteOffer={controls.inviteOffer()}
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
  // An account that signed up through a GTM invite link holds a free-month
  // promotion; the plan step shows it in place of the picker. Guarded read so
  // a pending fetch never suspends the flow.
  const inviteOfferQuery = useGtmInviteOfferQuery({ enabled: needsOnboarding });
  const inviteOffer = () =>
    inviteOfferQuery.isSuccess ? inviteOfferQuery.data : null;
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

  const [activeStepKey, setActiveStepKey] = createSignal('welcome');
  const stepIndex = createMemo(() =>
    resolveOnboardingStepIndex(
      steps().map((step) => step.key),
      activeStepKey()
    )
  );
  const currentStep = createMemo(() => steps()[stepIndex()]);
  const currentStepKey = createMemo(() => currentStep().key);
  // The plan step's header follows the offer without rebuilding the steps
  // (which would remount the step mid-flow).
  const stepTitle = () =>
    currentStep().key === 'plan' && inviteOffer()
      ? 'Your first month is on us'
      : currentStep().title;
  const stepSubtitle = () =>
    currentStep().key === 'plan' && inviteOffer()
      ? 'Your invite comes with Macro Premium free for the first month. You can change plans anytime.'
      : currentStep().subtitle;
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
      setActiveStepKey(saved.step ?? 'welcome');
    } catch {
      sessionStorage.removeItem(FLOW_STEP_STORAGE_KEY);
    }
  });

  createEffect(() => {
    const uid = userId();
    const step = currentStepKey();
    if (!restored || !uid) return;
    try {
      sessionStorage.setItem(
        FLOW_STEP_STORAGE_KEY,
        JSON.stringify({ user: uid, step })
      );
    } catch {
      /* The flow remains usable when browser storage is unavailable. */
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
    inviteOffer,
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
    <OnboardingShell
      wide={currentStep().wide}
      overlay={
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
      }
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
              <h1 class="text-3xl font-medium leading-tight tracking-tight text-ink sm:text-4xl">
                {stepTitle()}
              </h1>
              <Show when={stepSubtitle()}>
                <p class="max-w-md text-sm leading-relaxed text-ink-muted">
                  {stepSubtitle()}
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
          <Show
            when={isStoryStep(currentStep().key)}
            fallback={
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
            }
          >
            <StoryStage
              step={(() => {
                const key = currentStep().key;
                return isStoryStep(key) ? key : 'welcome';
              })()}
              onNext={controls.next}
            >
              <Suspense fallback={<StepFallback />}>
                {steps()
                  .find((step) => step.key === 'tools')
                  ?.render(controls)}
              </Suspense>
            </StoryStage>
          </Show>

          <Show when={!currentStep().noDot}>
            <div
              class="flex justify-center gap-1.5"
              role="progressbar"
              aria-label="Setup progress"
              aria-valuemin={1}
              aria-valuemax={steps().filter((step) => !step.noDot).length}
              aria-valuenow={
                steps()
                  .slice(0, stepIndex() + 1)
                  .filter((step) => !step.noDot).length
              }
            >
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
    </OnboardingShell>
  );
}
