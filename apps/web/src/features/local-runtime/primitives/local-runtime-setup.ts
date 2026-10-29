import type { MacrodDetectedAgent, MacrodStatus } from '@macro/tauri/macrod';
import { Telemetry } from '@macro-inc/observability';
import { err, ok, type Result, ResultAsync } from 'neverthrow';
import { createSignal } from 'solid-js';
import {
  agentHandle,
  chooseModel,
  errorMessage,
  offeredAgents,
  type ReadyAgent,
  type SetupCapabilities,
  type SetupChoices,
  type SetupState,
  type SetupStep,
} from '../core/setup';

/**
 * A freshly paired runtime reports its catalog only after its first
 * heartbeat, so a new agent's model load retries for a little while.
 */
const MODEL_LOAD_ATTEMPTS = 10;
const MODEL_LOAD_INTERVAL_MS = 1500;

const FALLBACK_ERRORS: Record<SetupStep, string> = {
  detect: 'Could not look for agents on this computer.',
  connect: 'Could not connect this computer to your account.',
  agent: 'Could not create your agent.',
};

/**
 * Runs the local runtime setup steps and exposes their progress. A failed
 * step can be retried; once the daemon is connected, a retry resumes at the
 * agent step instead of re-pairing.
 */
export function createLocalRuntimeSetup(caps: SetupCapabilities) {
  const [state, setState] = createSignal<SetupState>({ kind: 'idle' });
  const [agents, setAgents] = createSignal<MacrodDetectedAgent[]>();
  const [scanning, setScanning] = createSignal(false);
  /** The running daemon once connect succeeded, for resuming. */
  let connected: MacrodStatus | undefined;
  let lastChoices: SetupChoices = { fullAccess: false };

  const attempt = async <T>(
    step: SetupStep,
    work: () => Promise<T>
  ): Promise<Result<T, string>> => {
    setState({ kind: 'running', step });
    // Error messages can carry local paths, so the span records only the
    // outcome; the user sees the message.
    const span = Telemetry.span(`local_runtime.setup.${step}`);
    const result = await span.run(
      async () =>
        await ResultAsync.fromPromise(work(), (error) =>
          errorMessage(error, FALLBACK_ERRORS[step])
        )
    );
    span.setAttr('local_runtime.outcome', result.isOk() ? 'success' : 'error');
    span.end();
    if (result.isErr()) {
      setState({ kind: 'failed', step, message: result.error });
    }
    return result;
  };

  /** Look for installed agents without running setup, for the options. */
  const scan = async (): Promise<MacrodDetectedAgent[]> => {
    setScanning(true);
    const result = await ResultAsync.fromPromise(caps.detectAgents(), () => []);
    setScanning(false);
    const found = offeredAgents(result.isOk() ? result.value : []);
    setAgents(found);
    return found;
  };

  const connect = async (
    choices: SetupChoices
  ): Promise<Result<MacrodStatus, string>> => {
    const found = await attempt('detect', async () => {
      const offered = await scan();
      return choices.agentId
        ? offered.find((agent) => agent.id === choices.agentId)
        : offered[0];
    });
    if (found.isErr()) return err(found.error);
    const agent = found.value;
    if (!agent) {
      setState({ kind: 'no-agents' });
      return err('no-agents');
    }

    return await attempt('connect', async () => {
      await caps.startDaemon({
        agent: agent.id,
        workspace: choices.workspace?.trim() || undefined,
        scope: 'private',
        allowPermissionBypass: choices.fullAccess,
      });
      return await caps.waitForRunning((phase) =>
        setState({ kind: 'running', step: 'connect', phase })
      );
    });
  };

  const loadModel = async (harnessId: string): Promise<string> => {
    let lastError: unknown;
    for (let tries = 0; tries < MODEL_LOAD_ATTEMPTS; tries++) {
      if (tries > 0) await caps.sleep(MODEL_LOAD_INTERVAL_MS);
      const result = await ResultAsync.fromPromise(
        caps.loadModels(harnessId),
        (error) => error
      );
      if (result.isErr()) {
        lastError = result.error;
        continue;
      }
      const model = chooseModel(result.value);
      if (model) return model;
    }
    throw lastError ?? new Error('Your agent did not report any models.');
  };

  /** Reuse an agent already bound to this runtime, or create one. */
  const ensureAgent = async (
    status: MacrodStatus,
    choices: SetupChoices
  ): Promise<ReadyAgent> => {
    const harnessId = status.harnessId;
    if (!harnessId) throw new Error('This computer is not connected yet.');
    const existing = (await caps.listAgents()).find(
      (agent) => agent.harnessId === harnessId
    );
    if (existing) return existing;
    const name = status.agentName ?? 'Local agent';
    return await caps.createAgent({
      name,
      handle: agentHandle(name),
      description: `Runs ${name} on this computer with your own login.`,
      harnessId,
      defaultModel: await loadModel(harnessId),
      autoAcceptPermissions: choices.fullAccess,
    });
  };

  const finish = async (status: MacrodStatus, choices: SetupChoices) => {
    const agent = await attempt('agent', () => ensureAgent(status, choices));
    if (agent.isErr()) return;
    setState({
      kind: 'ready',
      agent: agent.value,
      workspace: status.workspace,
    });
  };

  // Every step sets a running state synchronously as it starts, so this
  // also covers the moment between one step finishing and the next.
  const inProgress = () => state().kind === 'running';

  /** Run every step, or resume after the daemon already connected. */
  const run = async (choices: SetupChoices = lastChoices) => {
    if (inProgress()) return;
    lastChoices = choices;
    // One trace per attempt, each step a child span.
    const span = Telemetry.span('local_runtime.setup');
    span.setAttr('local_runtime.resumed', connected !== undefined);
    await span.run(async () => {
      const status: Result<MacrodStatus, string> = connected
        ? ok(connected)
        : await connect(choices);
      if (status.isOk()) {
        connected = status.value;
        if (status.value.harnessId) {
          span.setAttr('harness.id', status.value.harnessId);
        }
        if (status.value.agentId) {
          span.setAttr('local_runtime.agent', status.value.agentId);
        }
        await finish(status.value, choices);
      }
    });
    span.setAttr('local_runtime.outcome', state().kind);
    span.end();
  };

  /** Start over from detection, e.g. after changing the options. */
  const restart = async (choices: SetupChoices) => {
    if (inProgress()) return;
    connected = undefined;
    await run(choices);
  };

  /** Finish setup for a daemon that is already running. */
  const adopt = async (status: MacrodStatus, choices: SetupChoices) => {
    if (inProgress()) return;
    connected = status;
    await run(choices);
  };

  return { state, agents, scanning, scan, run, restart, adopt };
}
