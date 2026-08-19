import type { Stream } from '@agentclientprotocol/sdk';

/** Executes commands inside a sandbox. Providers implement only the
 * transport; the commands themselves are identical across providers (see
 * provision.ts — they're coupled to the container image, not the provider). */
export interface CommandRunner {
  /** Run a command to completion; throws on non-zero exit. */
  run(command: string, opts?: { timeoutS?: number }): Promise<void>;
}

export interface SpawnOptions {
  /** Repo to clone into /workspace, e.g. "https://github.com/macro-inc/macro.git" */
  repoUrl: string;
  /** Extra env vars for the sandbox (GITHUB_TOKEN, ANTHROPIC_API_KEY, ...) */
  envVars?: Record<string, string>;
}

export interface AgentSandbox {
  readonly id: string;
  /** Bring the sandbox to "ready" (repo cloned, dev env realized, sidecar
   * answering) no matter its current state. Idempotent: call before every
   * connect — a fresh sandbox gets provisioned, a healthy one is a no-op,
   * and a restarted one heals. */
  ensure(): Promise<void>;
  /** Connect to the ACP proxy inside the container. Each call gets a fresh
   * agent process on the far end (process-per-connection). */
  connect(): Promise<Stream>;
  /** Give the sandbox back at session end. Pooling providers park it for
   * fast reuse; others destroy it. Don't use the sandbox afterwards. */
  release(): Promise<void>;
  /** Permanently remove the sandbox. */
  destroy(): Promise<void>;
}

export interface SandboxProvider {
  /** Create a sandbox: container up, repo cloned, ACP sidecar listening. */
  spawn(opts: SpawnOptions): Promise<AgentSandbox>;
  /** Reattach to an existing sandbox (e.g. after the caller restarted). */
  get(id: string): Promise<AgentSandbox>;
}
