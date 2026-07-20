/** A live, bidirectional byte stream to the agent (raw ndjson).
 * The ACP SDK does the framing; keeping this at the byte level means the
 * sidecar and transport stay dumb pipes. WhatWG streams so this ports
 * unchanged to a Cloudflare Worker / Durable Object. */
export interface AcpConnection {
  /** agent → us (ndjson bytes) */
  readonly readable: ReadableStream<Uint8Array>
  /** us → agent (ndjson bytes) */
  readonly writable: WritableStream<Uint8Array>
  close(): Promise<void>
}

export interface SpawnOptions {
  /** Repo to clone into /workspace, e.g. "https://github.com/macro-inc/macro.git" */
  repoUrl: string
  /** Extra env vars for the sandbox (GITHUB_TOKEN, ANTHROPIC_API_KEY, ...) */
  envVars?: Record<string, string>
}

export interface AgentSandbox {
  readonly id: string
  /** Connect to the ACP proxy inside the container. Each call gets a fresh
   * agent process on the far end (process-per-connection). */
  connect(): Promise<AcpConnection>
  destroy(): Promise<void>
}

export interface SandboxProvider {
  /** Create a sandbox: container up, repo cloned, ACP sidecar listening. */
  spawn(opts: SpawnOptions): Promise<AgentSandbox>
  /** Reattach to an existing sandbox (e.g. after the caller restarted). */
  get(id: string): Promise<AgentSandbox>
}
