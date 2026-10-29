import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

/**
 * Bridge to the bundled macrod daemon (the local agent runtime) supervised by
 * the desktop app's main process. Desktop only: callers gate on
 * `isDesktopPlatform()` before touching anything here.
 */

export type MacrodPhase =
  | 'stopped'
  | 'starting'
  | 'installing-adapter'
  | 'pairing'
  | 'running'
  | 'error';

/** The daemon snapshot the main process folds service events into. */
export type MacrodStatus = {
  phase: MacrodPhase;
  agentId: string | null;
  agentName: string | null;
  workspace: string | null;
  /** Open pairing code awaiting approval, `XXXX-XXXX`. */
  pairingCode: string | null;
  pairingExpiresAt: string | null;
  harnessId: string | null;
  lastError: string | null;
};

export type MacrodSupport = {
  /** Whether this build bundles the daemon on this platform. */
  supported: boolean;
  /** Suggested workspace directory for a first-time setup. */
  defaultWorkspace: string | null;
};

/** One installed agent, as reported by `macrod detect-agents`. */
export type MacrodDetectedAgent = {
  /** Stable preset id accepted by {@link macrodStart}, e.g. `claude-code`. */
  id: string;
  name: string;
  note: string | null;
  /** Whether selecting this agent downloads an ACP adapter first. */
  needs_install: boolean;
};

/** The service config's state, as reported by `macrod inspect`. */
export type MacrodInspection = {
  config_path: string;
  exists: boolean;
  paired: boolean;
  error?: string;
  harness_id?: string;
  agent_id?: string;
  agent_name?: string;
  workspace?: string;
  web_url?: string;
};

export type MacrodStartOptions = {
  agent?: string;
  workspace?: string;
  scope?: 'private' | 'team';
  allowPermissionBypass?: boolean;
};

export function macrodSupport(): Promise<MacrodSupport> {
  return invoke<MacrodSupport>('macrod_support');
}

export async function macrodDetectAgents(): Promise<MacrodDetectedAgent[]> {
  const result = await invoke<{ agents: MacrodDetectedAgent[] }>(
    'macrod_detect_agents'
  );
  return result.agents;
}

export function macrodInspect(): Promise<MacrodInspection> {
  return invoke<MacrodInspection>('macrod_inspect');
}

export function macrodStart(
  options: MacrodStartOptions
): Promise<MacrodStatus> {
  return invoke<MacrodStatus>('macrod_start', { options });
}

export function macrodStop(): Promise<MacrodStatus> {
  return invoke<MacrodStatus>('macrod_stop');
}

export function macrodStatus(): Promise<MacrodStatus> {
  return invoke<MacrodStatus>('macrod_status');
}

/** Subscribe to daemon snapshot changes; resolves to the unlisten function. */
export function onMacrodStatus(
  callback: (status: MacrodStatus) => void
): Promise<UnlistenFn> {
  return listen<MacrodStatus>('macrod-status', (event) =>
    callback(event.payload)
  );
}
