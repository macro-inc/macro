import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import { isDesktopPlatform } from '@core/util/platform';
import {
  type MacrodDetectedAgent,
  type MacrodStatus as MacrodSnapshot,
  type MacrodSupport,
  macrodDetectAgents,
  macrodInspect,
  macrodStart,
  macrodStatus,
  macrodStop,
  macrodSupport,
  onMacrodStatus,
} from '@macro/tauri/macrod';
import LaptopIcon from '@phosphor/laptop.svg';
import SpinnerIcon from '@phosphor/spinner-gap.svg';
import { useApproveHarnessPairingMutation } from '@queries/harnesses/harnesses';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { Button } from '@ui';
import {
  createSignal,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import { HarnessIcon, StatusDot } from '../integration-ui';
import { SettingsCard } from '../primitives';
import { SettingsSelect } from './settings-select';

function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.length > 0) return error;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

/**
 * One-click local runtime on the desktop app: the bundled macrod daemon is
 * configured, paired, and supervised without the user touching a terminal.
 * The card detects which coding agents are installed on this computer, and
 * approving the pairing happens automatically — the daemon reports its code
 * over the sidecar channel and this card approves it with the signed-in
 * session, so no code is ever typed.
 */
export function LocalRuntimeCard() {
  // Everything here talks to the Tauri main process; on other platforms the
  // card renders nothing and calls nothing.
  if (!isDesktopPlatform()) return null;

  const approvePairing = useApproveHarnessPairingMutation();
  const [support, setSupport] = createSignal<MacrodSupport>();
  const [snapshot, setSnapshot] = createSignal<MacrodSnapshot>();
  /** Whether a paired config already exists on disk (daemon may be stopped). */
  const [paired, setPaired] = createSignal(false);
  const [setupOpen, setSetupOpen] = createSignal(false);
  const [agents, setAgents] = createSignal<MacrodDetectedAgent[]>();
  const [scanning, setScanning] = createSignal(false);
  const [selectedAgent, setSelectedAgent] = createSignal<string>();
  const [workspace, setWorkspace] = createSignal('');
  const [fullAccess, setFullAccess] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [approveFailed, setApproveFailed] = createSignal(false);

  // One approval attempt per pairing code; a failed attempt surfaces a Retry
  // affordance instead of hammering the endpoint from the status stream.
  const attemptedCodes = new Set<string>();

  const approveCode = (code: string) => {
    attemptedCodes.add(code);
    setApproveFailed(false);
    approvePairing.mutate(
      { code, allowPermissionBypass: fullAccess() },
      {
        onError: () => setApproveFailed(true),
      }
    );
  };

  const handleStatus = (next: MacrodSnapshot) => {
    setSnapshot(next);
    if (next.phase === 'running') setPaired(true);
    if (
      next.phase === 'pairing' &&
      next.pairingCode &&
      !attemptedCodes.has(next.pairingCode)
    ) {
      approveCode(next.pairingCode);
    }
  };

  onMount(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    const probe = async () => {
      try {
        const [supportInfo, current] = await Promise.all([
          macrodSupport(),
          macrodStatus(),
        ]);
        if (disposed) return;
        setSupport(supportInfo);
        if (!workspace() && supportInfo.defaultWorkspace) {
          setWorkspace(supportInfo.defaultWorkspace);
        }
        handleStatus(current);
        if (!supportInfo.supported) return;
        unlisten = await onMacrodStatus(handleStatus);
        if (disposed) {
          fireAndForget(unlisten(), 'local-runtime-card');
          return;
        }
        const inspection = await macrodInspect();
        if (!disposed && inspection.paired) setPaired(true);
      } catch (error) {
        console.error('could not probe the bundled macrod daemon', error);
      }
    };
    fireAndForget(probe(), 'local-runtime-card');
    onCleanup(() => {
      disposed = true;
      const dispose = unlisten;
      if (dispose) fireAndForget(dispose(), 'local-runtime-card');
    });
  });

  const scanAgents = async () => {
    setScanning(true);
    try {
      const found = await macrodDetectAgents();
      setAgents(found);
      if (found.length > 0 && !found.some((a) => a.id === selectedAgent())) {
        setSelectedAgent(found[0].id);
      }
    } catch (error) {
      setAgents([]);
      toast.failure(
        errorMessage(error, 'Could not scan this computer for agents')
      );
    } finally {
      setScanning(false);
    }
  };

  const openSetup = () => {
    setSetupOpen(true);
    // scanAgents reports its own failures through the toast.
    fireAndForget(scanAgents(), 'local-runtime-card');
  };

  const startWithSetup = async () => {
    const agent = selectedAgent();
    if (!agent || busy()) return;
    setBusy(true);
    try {
      await macrodStart({
        agent,
        workspace: workspace().trim() || undefined,
        scope: 'private',
        allowPermissionBypass: fullAccess(),
      });
      setSetupOpen(false);
    } catch (error) {
      toast.failure(errorMessage(error, 'Could not start the local runtime'));
    } finally {
      setBusy(false);
    }
  };

  const startExisting = async () => {
    if (busy()) return;
    setBusy(true);
    try {
      await macrodStart({});
    } catch (error) {
      toast.failure(errorMessage(error, 'Could not start the local runtime'));
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    if (busy()) return;
    setBusy(true);
    try {
      await macrodStop();
    } catch (error) {
      toast.failure(errorMessage(error, 'Could not stop the local runtime'));
    } finally {
      setBusy(false);
    }
  };

  const phase = () => snapshot()?.phase ?? 'stopped';
  const working = () =>
    phase() === 'starting' ||
    phase() === 'installing-adapter' ||
    phase() === 'pairing';

  return (
    <Show when={support()?.supported}>
      <div>
        <h2 class="mb-3 px-6 text-sm font-semibold text-ink">This computer</h2>
        <SettingsCard>
          <section class="flex gap-4 px-6 py-5">
            <HarnessIcon>
              <LaptopIcon />
            </HarnessIcon>
            <div class="min-w-0 flex-1">
              <div class="flex min-h-5 items-center justify-between gap-3">
                <div class="flex min-w-0 items-center gap-2">
                  <h2 class="min-w-0 text-sm/5 font-medium text-ink">
                    Run agents on this computer
                  </h2>
                  <StatusDot
                    state={
                      phase() === 'running'
                        ? 'connected'
                        : phase() === 'error'
                          ? 'attention'
                          : 'disconnected'
                    }
                    label={
                      phase() === 'running'
                        ? 'Running'
                        : phase() === 'error'
                          ? 'Error'
                          : 'Not running'
                    }
                  />
                </div>
                <Show when={phase() === 'running'}>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy()}
                    onClick={() => fireAndForget(stop(), 'local-runtime-card')}
                  >
                    Stop
                  </Button>
                </Show>
              </div>
              <p class="mt-1 text-sm text-ink-muted">
                Macro runs agents you already have installed — Claude Code,
                Codex, and more — right here on your machine, using your own
                subscriptions and your local files.
              </p>

              <Switch>
                <Match when={working()}>
                  <div class="mt-4 flex items-center gap-2 text-sm text-ink-muted">
                    <SpinnerIcon class="size-4 animate-spin" />
                    <Switch>
                      <Match when={phase() === 'installing-adapter'}>
                        Installing the agent adapter…
                      </Match>
                      <Match when={phase() === 'pairing'}>
                        <Show
                          when={!approveFailed()}
                          fallback={
                            <span class="flex items-center gap-2">
                              Could not connect this computer.
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  const code = snapshot()?.pairingCode;
                                  if (code) approveCode(code);
                                }}
                              >
                                Retry
                              </Button>
                            </span>
                          }
                        >
                          Connecting this computer to your account…
                        </Show>
                      </Match>
                      <Match when>Starting…</Match>
                    </Switch>
                  </div>
                </Match>

                <Match when={phase() === 'running'}>
                  <p class="mt-4 text-sm text-ink-muted">
                    <span class="font-medium text-ink">
                      {snapshot()?.agentName ?? 'Your agent'}
                    </span>{' '}
                    is ready
                    <Show when={snapshot()?.workspace}>
                      {(dir) => (
                        <>
                          {' '}
                          in <span class="font-mono text-xs">{dir()}</span>
                        </>
                      )}
                    </Show>
                    . Keep the app open; create an agent below to start using
                    it.
                  </p>
                </Match>

                <Match when={phase() === 'error'}>
                  <div class="mt-4 flex flex-wrap items-center gap-3">
                    <p class="text-sm text-negative">
                      {snapshot()?.lastError ?? 'The local runtime stopped.'}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy()}
                      onClick={() =>
                        paired()
                          ? fireAndForget(startExisting(), 'local-runtime-card')
                          : openSetup()
                      }
                    >
                      Try again
                    </Button>
                  </div>
                </Match>

                <Match when={setupOpen()}>
                  <div class="mt-4 flex flex-col gap-4">
                    <Show
                      when={!scanning()}
                      fallback={
                        <p class="flex items-center gap-2 text-sm text-ink-muted">
                          <SpinnerIcon class="size-4 animate-spin" />
                          Looking for agents installed on this computer…
                        </p>
                      }
                    >
                      <Show
                        when={(agents()?.length ?? 0) > 0}
                        fallback={
                          <div class="flex flex-col gap-2">
                            <p class="text-sm text-ink-muted">
                              No supported agents were found on this computer.
                              Install Claude Code, Codex, OpenCode, or OpenClaw,
                              then scan again.
                            </p>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              class="w-fit"
                              onClick={() =>
                                fireAndForget(
                                  scanAgents(),
                                  'local-runtime-card'
                                )
                              }
                            >
                              Scan again
                            </Button>
                          </div>
                        }
                      >
                        <div class="flex w-full max-w-72 flex-col gap-1.5">
                          <span class="text-xs font-medium text-ink">
                            Agent found on this computer
                          </span>
                          <SettingsSelect
                            label="Agent"
                            options={(agents() ?? []).map((agent) => ({
                              id: agent.id,
                              name: agent.name,
                            }))}
                            value={selectedAgent()}
                            onChange={setSelectedAgent}
                          />
                          <Show
                            when={
                              agents()?.find((a) => a.id === selectedAgent())
                                ?.needs_install
                            }
                            fallback={
                              <p class="text-xs text-ink-extra-muted">
                                Sessions run with your existing login and
                                subscription.
                              </p>
                            }
                          >
                            <p class="text-xs text-ink-extra-muted">
                              A small connector is downloaded on first start;
                              sessions run with your existing login and
                              subscription.
                            </p>
                          </Show>
                        </div>
                        <div class="flex w-full max-w-72 flex-col gap-1.5">
                          <label
                            for="local-runtime-workspace"
                            class="text-xs font-medium text-ink"
                          >
                            Workspace folder
                          </label>
                          <input
                            id="local-runtime-workspace"
                            type="text"
                            spellcheck={false}
                            class="settings-input min-w-0"
                            value={workspace()}
                            onInput={(event) =>
                              setWorkspace(event.currentTarget.value)
                            }
                          />
                          <p class="text-xs text-ink-extra-muted">
                            Where sessions run. Created if it doesn't exist.
                          </p>
                        </div>
                        <label class="flex w-fit items-start gap-2 text-sm text-ink">
                          <input
                            type="checkbox"
                            class="mt-0.5"
                            checked={fullAccess()}
                            onChange={(event) =>
                              setFullAccess(event.currentTarget.checked)
                            }
                          />
                          <span>
                            Full access
                            <span class="block text-xs text-ink-extra-muted">
                              Let agents run commands and edit files without
                              asking each time.
                            </span>
                          </span>
                        </label>
                        <div class="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="cta"
                            size="sm"
                            disabled={busy() || !selectedAgent()}
                            onClick={() =>
                              fireAndForget(
                                startWithSetup(),
                                'local-runtime-card'
                              )
                            }
                          >
                            {busy() ? 'Starting…' : 'Start running agents here'}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setSetupOpen(false)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </Show>
                    </Show>
                  </div>
                </Match>

                <Match when={paired()}>
                  <div class="mt-4 flex flex-wrap items-center gap-3">
                    <p class="text-sm text-ink-muted">
                      This computer is set up but not running.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy()}
                      onClick={() =>
                        fireAndForget(startExisting(), 'local-runtime-card')
                      }
                    >
                      {busy() ? 'Starting…' : 'Start'}
                    </Button>
                  </div>
                </Match>

                <Match when>
                  <div class="mt-4">
                    <Button
                      type="button"
                      variant="cta"
                      size="sm"
                      onClick={openSetup}
                    >
                      Set up
                    </Button>
                  </div>
                </Match>
              </Switch>
            </div>
          </section>
        </SettingsCard>
      </div>
    </Show>
  );
}
