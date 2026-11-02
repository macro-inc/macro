import type {
  MacrodDetectedAgent,
  MacrodStartOptions,
  MacrodStatus,
} from '@macro/tauri/macrod';
import type { LoadAgentModelsResponse } from '@service-agent-harness/generated/schemas';
import { match } from 'ts-pattern';

/**
 * One-click local runtime setup on the desktop app: find a coding agent
 * installed on this computer, connect the bundled macrod daemon to the
 * user's account, and create a Macro agent that runs on it.
 */

/** The steps the user watches, in order. */
export const SETUP_STEPS = ['detect', 'connect', 'agent'] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

export type ReadyAgent = {
  botId: string;
  name: string;
  handle: string;
};

export type SetupState =
  | { kind: 'idle' }
  | { kind: 'running'; step: SetupStep; phase?: MacrodStatus['phase'] }
  | { kind: 'no-agents' }
  | { kind: 'failed'; step: SetupStep; message: string }
  | { kind: 'ready'; agent: ReadyAgent; workspace: string | null };

export type StepStatus = 'pending' | 'active' | 'done' | 'failed';

/** What the user may override before running; everything has a default. */
export type SetupChoices = {
  /** Preset id from detection; the preferred detected agent when absent. */
  agentId?: string;
  workspace?: string;
  fullAccess: boolean;
};

/** An agent already bound to a runtime, as far as setup cares. */
type BoundAgent = {
  botId: string;
  name: string;
  handle: string;
  harnessId: string | null;
};

export type NewLocalAgent = {
  name: string;
  handle: string;
  description: string;
  harnessId: string;
  defaultModel: string;
  autoAcceptPermissions: boolean;
};

/**
 * Everything setup does outside itself. Production wires the Tauri bridge and
 * the agent queries; tests pass fakes.
 */
export type SetupCapabilities = {
  detectAgents: () => Promise<MacrodDetectedAgent[]>;
  startDaemon: (options: MacrodStartOptions) => Promise<MacrodStatus>;
  /**
   * Resolves with the daemon's status once it is running; rejects on an
   * error phase or when it never gets there.
   */
  waitForRunning: (
    onPhase: (phase: MacrodStatus['phase']) => void
  ) => Promise<MacrodStatus>;
  listAgents: () => Promise<BoundAgent[]>;
  loadModels: (harnessId: string) => Promise<LoadAgentModelsResponse>;
  createAgent: (agent: NewLocalAgent) => Promise<ReadyAgent>;
  /** Waits between model-load attempts while the runtime comes online. */
  sleep: (ms: number) => Promise<void>;
};

/**
 * Agents in the order setup prefers them. Herdr variants need a running herdr
 * terminal, so a headless desktop daemon never picks them by itself.
 */
const AGENT_PREFERENCE = [
  'claude-code',
  'codex',
  'opencode',
  'openclaw',
  'hermes',
];

/** The agents setup offers, preferred first. */
export function offeredAgents(
  detected: readonly MacrodDetectedAgent[]
): MacrodDetectedAgent[] {
  const rank = (agent: MacrodDetectedAgent) => {
    const index = AGENT_PREFERENCE.indexOf(agent.id);
    return index === -1 ? AGENT_PREFERENCE.length : index;
  };
  return detected
    .filter((agent) => !agent.id.startsWith('herdr-') && agent.id !== 'custom')
    .sort((a, b) => rank(a) - rank(b));
}

/** The model a new agent starts on, or none while the catalog is empty. */
export function chooseModel(
  response: LoadAgentModelsResponse
): string | undefined {
  if (response.status === 'unsupported') return 'default';
  const current = response.currentModel;
  if (current && response.models.some((model) => model.id === current)) {
    return current;
  }
  return response.models[0]?.id ?? current ?? undefined;
}

export function agentHandle(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function stepStatus(state: SetupState, step: SetupStep): StepStatus {
  const index = SETUP_STEPS.indexOf(step);
  const at = (current: SetupStep, here: StepStatus): StepStatus => {
    const currentIndex = SETUP_STEPS.indexOf(current);
    if (index < currentIndex) return 'done';
    if (index > currentIndex) return 'pending';
    return here;
  };
  return match(state)
    .with({ kind: 'idle' }, (): StepStatus => 'pending')
    .with({ kind: 'ready' }, (): StepStatus => 'done')
    .with({ kind: 'no-agents' }, () => at('detect', 'failed'))
    .with({ kind: 'running' }, (s) => at(s.step, 'active'))
    .with({ kind: 'failed' }, (s) => at(s.step, 'failed'))
    .exhaustive();
}

export function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.length > 0) return error;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
