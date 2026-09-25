import { createSignal, Match, onCleanup, Show, Switch } from 'solid-js';
import { GoogleAccountsStep } from '../components/GoogleAccountsStep';
import { ImportSummary } from '../components/ImportSummary';
import { OnboardingShell } from '../components/OnboardingShell';
import { OnboardingTrustDetails } from '../components/OnboardingTrustDetails';
import { StoryStage } from '../components/StoryStage';
import { buildGoogleWorkOnboardingUrl } from '../core/onboardingHandoff';
import type { OnboardingIntegration } from '../core/onboardingIntegrations';
import { ONBOARDING_CONNECTORS } from '../flow/onboardingConnectorConfig';
import { ToolsStep } from '../flow/ToolsStep';
import { transitionOnboardingStep } from '../primitives/animateOnboardingStep';
import { animateSecurityHandoff } from '../primitives/animateSecurityHandoff';
import { PublicTeamStep } from './PublicTeamStep';

/** Shared pre-account introduction; real Google authorization continues in /login. */
export function PublicOnboarding(props: {
  loginUrl: string;
  preview?: boolean;
  onFeaturesSelected: (features: string[]) => void;
}) {
  const steps = [
    'welcome',
    'vision',
    'security',
    'work',
    'personal',
    'tools',
    'summary',
    'team',
  ] as const;
  type Step = (typeof steps)[number];
  const [step, setStep] = createSignal<Step>('welcome');
  const [selected, setSelected] = createSignal<OnboardingIntegration[]>([]);
  const [connecting, setConnecting] = createSignal(false);
  let content!: HTMLDivElement;
  let disposeHandoff: (() => void) | undefined;
  onCleanup(() => disposeHandoff?.());
  const goTo = (next: Step) => {
    disposeHandoff?.();
    const commit = () => {
      setStep(next);
      queueMicrotask(() => {
        content
          ?.closest('.onboarding-flow')
          ?.querySelector('[data-onboarding-scroll]')
          ?.scrollTo({ top: 0, behavior: 'instant' });
        content
          ?.querySelector<HTMLElement>('h1')
          ?.focus({ preventScroll: true });
      });
    };
    if (step() === 'welcome' && next === 'vision')
      disposeHandoff = animateSecurityHandoff(content, commit, 'intro');
    else if (step() === 'vision' && next === 'security')
      disposeHandoff = animateSecurityHandoff(content, commit, 'features');
    else if (step() === 'security' && next === 'work')
      disposeHandoff = animateSecurityHandoff(content, commit);
    else if (step() !== next)
      disposeHandoff = transitionOnboardingStep(content, commit);
    else commit();
  };
  const connectWork = () => {
    if (props.preview) {
      goTo('personal');
      return;
    }
    if (connecting()) return;
    setConnecting(true);
    window.location.assign(buildGoogleWorkOnboardingUrl(props.loginUrl));
  };

  return (
    <OnboardingShell
      wide
      onBack={
        step() !== 'welcome'
          ? () => goTo(steps[steps.indexOf(step()) - 1])
          : undefined
      }
      explainer={
        ['security', 'work', 'personal'].includes(step()) ? (
          <OnboardingTrustDetails
            topic={step() === 'security' ? 'security' : 'google'}
          />
        ) : undefined
      }
    >
      <div ref={content} class="flex flex-col gap-8">
        <Switch>
          <Match
            when={
              step() === 'welcome' ||
              step() === 'vision' ||
              step() === 'security'
            }
          >
            <StoryStage
              step={
                step() === 'welcome'
                  ? 'welcome'
                  : step() === 'vision'
                    ? 'vision'
                    : 'security'
              }
              onNext={(features) => {
                if (features) props.onFeaturesSelected(features);
                goTo(steps[steps.indexOf(step()) + 1]);
              }}
              durationMs={650}
            >
              {null}
            </StoryStage>
          </Match>
          <Match when={step() === 'work'}>
            <GoogleAccountsStep
              connecting={connecting() ? 'work' : undefined}
              onConnectWork={connectWork}
              onConnectPersonal={() => {}}
            />
          </Match>
          <Match when={props.preview && step() === 'personal'}>
            <GoogleAccountsStep
              mode="personal"
              workConnected
              onConnectWork={() => {}}
              onConnectPersonal={() => goTo('tools')}
              onSkip={() => goTo('tools')}
            />
          </Match>
          <Match when={props.preview && step() === 'tools'}>
            <StoryStage step="tools" onNext={() => {}}>
              <ToolsStep
                preview
                connectorNames={ONBOARDING_CONNECTORS.map(
                  (item) => item.serverName
                )}
                selected={selected()}
                onSelectionChange={setSelected}
                onContinue={() => goTo('summary')}
              />
            </StoryStage>
          </Match>
          <Match when={props.preview && step() === 'summary'}>
            <ImportSummary
              inboxCount={2}
              emailState="syncing"
              emailProgress={{ completed: 840, total: 1200 }}
              contactCount={128}
              runs={selected()
                .filter(
                  (item) =>
                    item.id === 'linear' ||
                    item.id === 'notion' ||
                    item.id === 'slack'
                )
                .map((item) => ({
                  source:
                    item.id === 'linear'
                      ? 'linear'
                      : item.id === 'notion'
                        ? 'notion'
                        : 'slack',
                  status: 'running',
                  auto_import: true,
                  updated_at: '2026-09-25T12:00:00Z',
                }))}
              entities={[]}
              onRefresh={() => {}}
              onRetryGather={() => {}}
              onContinue={() => goTo('team')}
            />
          </Match>
          <Match when={props.preview && step() === 'team'}>
            <PublicTeamStep
              onContinue={() => window.location.assign(props.loginUrl)}
            />
          </Match>
        </Switch>
        <Show when={step() === 'welcome' || step() === 'security'}>
          <p class="text-center text-sm leading-6 text-ink-extra-muted">
            Already have an account?
            <br />
            <a
              href={props.loginUrl}
              class="inline-block rounded-sm pt-2 text-ink-muted underline underline-offset-4 hover:text-ink focus-visible:outline-2 focus-visible:outline-ink"
            >
              Sign in
            </a>
          </p>
        </Show>
      </div>
    </OnboardingShell>
  );
}
