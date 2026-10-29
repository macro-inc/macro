import { SettingsSelect } from '@app/features/settings/components/settings-select';
import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import CheckCircleIcon from '@icon/system/regular/check-circle.svg';
import SpinnerIcon from '@icon/system/regular/spinner-gap.svg';
import type { MacrodStatus } from '@macro/tauri/macrod';
import { Button, cn } from '@ui';
import { createSignal, Match, onMount, Show, Switch } from 'solid-js';
import { match } from 'ts-pattern';
import {
  type ChecklistStep,
  SetupChecklist,
} from '../components/setup-checklist';
import {
  type ReadyAgent,
  SETUP_STEPS,
  type SetupCapabilities,
  type SetupChoices,
  type SetupState,
  type SetupStep,
  stepStatus,
} from '../core/setup';
import { createLocalRuntimeSetup } from '../primitives/local-runtime-setup';

/**
 * The whole local runtime setup in one place: the agent it found, optional
 * overrides, live progress, and a way into the first session. Hosted by the
 * first-run dialog and the Settings card, through the `LocalRuntimeSetup`
 * entry point that supplies the production capabilities.
 */
export function LocalRuntimeSetupPanel(props: {
  capabilities: SetupCapabilities;
  /** Open a first session with the agent setup made. */
  onOpenSession: (agent: ReadyAgent) => void;
  defaultWorkspace?: string;
  /**
   * A daemon that already runs but has no agent yet: setup skips straight to
   * creating one.
   */
  running?: MacrodStatus;
  /** Start right away rather than waiting for the Set up button. */
  autoStart?: boolean;
  onClose?: () => void;
}) {
  const setup = createLocalRuntimeSetup(props.capabilities);
  const [optionsOpen, setOptionsOpen] = createSignal(false);
  const [agentId, setAgentId] = createSignal<string>();
  const [workspace, setWorkspace] = createSignal(props.defaultWorkspace ?? '');
  const [fullAccess, setFullAccess] = createSignal(false);

  const choices = (): SetupChoices => ({
    agentId: agentId() ?? setup.agents()?.[0]?.id,
    workspace: workspace(),
    fullAccess: fullAccess(),
  });
  const chosenAgent = () => {
    const id = choices().agentId;
    return setup.agents()?.find((agent) => agent.id === id);
  };
  const agentName = () => props.running?.agentName ?? chosenAgent()?.name ?? '';

  const start = () => {
    const running = props.running;
    fireAndForget(
      running ? setup.adopt(running, choices()) : setup.restart(choices()),
      'local-runtime-setup'
    );
  };

  onMount(() => {
    if (props.running) {
      start();
      return;
    }
    fireAndForget(
      (async () => {
        await setup.scan();
        if (props.autoStart && (setup.agents()?.length ?? 0) > 0) start();
      })(),
      'local-runtime-setup'
    );
  });

  const openSession = (agent: ReadyAgent) => {
    props.onOpenSession(agent);
    props.onClose?.();
  };

  const detail = (state: SetupState, step: SetupStep): string | undefined =>
    match(step)
      .with('detect', () =>
        stepStatus(state, 'detect') === 'done' && agentName()
          ? t('localRuntime.stepDetectDone', { agent: agentName() })
          : undefined
      )
      .with('connect', () =>
        state.kind === 'running' && state.step === 'connect'
          ? match(state.phase)
              .with('installing-adapter', () =>
                t('localRuntime.stepConnectInstalling', { agent: agentName() })
              )
              .with('pairing', () => t('localRuntime.stepConnectPairing'))
              .otherwise(() => t('localRuntime.stepConnectStarting'))
          : undefined
      )
      .with('agent', () =>
        state.kind === 'ready'
          ? t('localRuntime.stepAgentDone', { handle: state.agent.handle })
          : undefined
      )
      .exhaustive();

  const steps = (): ChecklistStep[] => {
    const state = setup.state();
    return SETUP_STEPS.map((step) => ({
      id: step,
      label: match(step)
        .with('detect', () => t('localRuntime.stepDetect'))
        .with('connect', () => t('localRuntime.stepConnect'))
        .with('agent', () => t('localRuntime.stepAgent'))
        .exhaustive(),
      detail:
        state.kind === 'failed' && state.step === step
          ? state.message
          : detail(state, step),
      status: stepStatus(state, step),
    }));
  };

  const failed = () => setup.state().kind === 'failed';
  const ready = () => {
    const state = setup.state();
    return state.kind === 'ready' ? state : undefined;
  };

  return (
    <div class="flex flex-col gap-4">
      <Switch>
        <Match when={ready()}>
          {(state) => (
            <div class="flex flex-col gap-4">
              <div class="flex items-start gap-3">
                <CheckCircleIcon
                  aria-hidden="true"
                  class="mt-0.5 size-5 shrink-0 text-success"
                />
                <div class="min-w-0">
                  <p class="text-sm font-medium text-ink">
                    {t('localRuntime.readyTitle', {
                      handle: state().agent.handle,
                    })}
                  </p>
                  <p class="mt-0.5 text-sm text-ink-muted">
                    {t('localRuntime.readyDescription')}
                  </p>
                  <Show when={state().workspace}>
                    {(dir) => (
                      <p class="mt-1 text-xs text-ink-extra-muted">
                        {t('localRuntime.readyWorkspace', {
                          workspace: dir(),
                        })}
                      </p>
                    )}
                  </Show>
                </div>
              </div>
              <div class="flex items-center gap-2">
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={() => openSession(state().agent)}
                >
                  {t('localRuntime.startSession')}
                </Button>
                <Show when={props.onClose}>
                  {(close) => (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => close()()}
                    >
                      {t('localRuntime.done')}
                    </Button>
                  )}
                </Show>
              </div>
            </div>
          )}
        </Match>

        <Match when={setup.state().kind === 'idle' && setup.scanning()}>
          <p class="flex items-center gap-2 text-sm text-ink-muted">
            <SpinnerIcon aria-hidden="true" class="size-4 animate-spin" />
            {t('localRuntime.scanning')}
          </p>
        </Match>

        <Match
          when={
            setup.state().kind === 'no-agents' ||
            (setup.state().kind === 'idle' && setup.agents()?.length === 0)
          }
        >
          <div class="flex flex-col items-start gap-2">
            <p class="text-sm text-ink-muted">{t('localRuntime.noAgents')}</p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={setup.scanning()}
              onClick={() => fireAndForget(setup.scan(), 'local-runtime-setup')}
            >
              {t('localRuntime.scanAgain')}
            </Button>
          </div>
        </Match>

        <Match when={setup.state().kind === 'idle'}>
          <div class="flex flex-col gap-3">
            <Show when={chosenAgent()}>
              {(agent) => (
                <p class="text-sm text-ink">
                  {t('localRuntime.found', { agent: agent().name })}
                </p>
              )}
            </Show>
            <SetupOptions
              open={optionsOpen()}
              onToggle={() => setOptionsOpen(!optionsOpen())}
              agents={(setup.agents() ?? []).map((agent) => ({
                id: agent.id,
                name: agent.name,
              }))}
              agentId={choices().agentId}
              onAgent={setAgentId}
              needsInstall={chosenAgent()?.needs_install === true}
              workspace={workspace()}
              onWorkspace={setWorkspace}
              fullAccess={fullAccess()}
              onFullAccess={setFullAccess}
            />
            <div>
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={!chosenAgent()}
                onClick={start}
              >
                {chosenAgent()
                  ? t('localRuntime.setUpWith', { agent: agentName() })
                  : t('localRuntime.setUp')}
              </Button>
            </div>
          </div>
        </Match>

        <Match when>
          <div class="flex flex-col gap-4">
            <SetupChecklist steps={steps()} />
            <Show when={failed()}>
              <div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    fireAndForget(setup.run(choices()), 'local-runtime-setup')
                  }
                >
                  {t('localRuntime.tryAgain')}
                </Button>
              </div>
            </Show>
          </div>
        </Match>
      </Switch>
    </div>
  );
}

function SetupOptions(props: {
  open: boolean;
  onToggle: () => void;
  agents: { id: string; name: string }[];
  agentId: string | undefined;
  onAgent: (id: string) => void;
  needsInstall: boolean;
  workspace: string;
  onWorkspace: (value: string) => void;
  fullAccess: boolean;
  onFullAccess: (value: boolean) => void;
}) {
  return (
    <div class="flex flex-col gap-3">
      <button
        type="button"
        class="flex w-fit items-center gap-1 text-xs font-medium text-ink-muted not-touch:hover:text-ink"
        aria-expanded={props.open}
        onClick={() => props.onToggle()}
      >
        {t('localRuntime.options')}
        <CaretDownIcon
          aria-hidden="true"
          class={cn('size-3 transition-transform', props.open && 'rotate-180')}
        />
      </button>
      <Show when={props.open}>
        <div class="flex flex-col gap-4">
          <Show when={props.agents.length > 1}>
            <div class="flex w-full max-w-72 flex-col gap-1.5">
              <span class="text-xs font-medium text-ink">
                {t('localRuntime.agentLabel')}
              </span>
              <SettingsSelect
                label={t('localRuntime.agentLabel')}
                options={props.agents}
                value={props.agentId}
                onChange={props.onAgent}
              />
            </div>
          </Show>
          <div class="flex w-full max-w-72 flex-col gap-1.5">
            <label
              for="local-runtime-workspace"
              class="text-xs font-medium text-ink"
            >
              {t('localRuntime.workspaceLabel')}
            </label>
            <input
              id="local-runtime-workspace"
              type="text"
              spellcheck={false}
              class="settings-input min-w-0"
              value={props.workspace}
              onInput={(event) => props.onWorkspace(event.currentTarget.value)}
            />
            <p class="text-xs text-ink-extra-muted">
              {t('localRuntime.workspaceHint')}
            </p>
          </div>
          <label class="flex w-full items-start gap-3 rounded-lg border border-edge-muted p-4 text-sm text-ink">
            <input
              type="checkbox"
              class="mt-0.5 size-5 shrink-0 accent-accent"
              checked={props.fullAccess}
              onChange={(event) =>
                props.onFullAccess(event.currentTarget.checked)
              }
            />
            <span>
              <span class="flex flex-wrap items-center gap-2 font-semibold">
                {t('localRuntime.fullAccess')}
                <span class="rounded-full bg-ink/6 px-2 py-0.5 text-xs font-medium text-ink-muted">
                  {t('localRuntime.suggested')}
                </span>
              </span>
              <span class="mt-1 block text-sm text-ink-muted">
                {t('localRuntime.fullAccessHint')}
              </span>
            </span>
          </label>
          <Show when={props.needsInstall}>
            <p class="text-xs text-ink-extra-muted">
              {t('localRuntime.connectorHint')}
            </p>
          </Show>
        </div>
      </Show>
    </div>
  );
}
