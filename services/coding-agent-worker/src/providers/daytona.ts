import { Daytona, Image } from '@daytona/sdk'
import type { AcpConnection, AgentSandbox, SandboxProvider, SpawnOptions } from '../interfaces'
import { clientWsConnection } from '../acp/streams'

const SIDECAR_PORT = 8700

function assertSafeRepoUrl(url: string): void {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    throw new Error(`invalid repoUrl: ${url}`)
  }
  if (u.protocol !== 'https:') throw new Error('repoUrl must be https')
  // The URL is interpolated into a shell clone command; refuse anything that
  // could break out of it (auth is a separate header, never in the URL).
  if (/[\s"'`$\\;|&<>()]/.test(url)) throw new Error('repoUrl contains illegal characters')
}

/** Poll the sidecar's /ping through the preview proxy until it answers. */
async function waitForSidecar(sandbox: { getSignedPreviewUrl: (p: number) => Promise<{ url: string }> }, timeoutMs = 60000): Promise<void> {
  const preview = await sandbox.getSignedPreviewUrl(SIDECAR_PORT)
  const pingUrl = preview.url.replace(/\/$/, '') + '/ping'
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(pingUrl)
      if (res.ok) return
    } catch {
      // sidecar not up yet
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('sidecar did not become ready within timeout')
}

class DaytonaSandbox implements AgentSandbox {
  constructor(
    readonly id: string,
    private readonly daytona: Daytona,
  ) {}

  async connect(): Promise<AcpConnection> {
    const sandbox = await this.daytona.get(this.id)
    const preview = await sandbox.getSignedPreviewUrl(SIDECAR_PORT)
    return clientWsConnection(preview.url.replace(/^http/, 'ws'))
  }

  async destroy(): Promise<void> {
    const sandbox = await this.daytona.get(this.id)
    await sandbox.delete()
  }
}

export class DaytonaProvider implements SandboxProvider {
  private readonly daytona = new Daytona()

  async spawn(opts: SpawnOptions): Promise<AgentSandbox> {
    assertSafeRepoUrl(opts.repoUrl)

    const sandbox = await this.daytona.create(
      {
        image: Image.fromDockerfile('container/Dockerfile'),
        envVars: opts.envVars,
        autoStopInterval: 0, // long-lived: we manage teardown explicitly
      },
      { timeout: 0, onSnapshotCreateLogs: (chunk) => process.stderr.write(chunk) },
    )

    // Clone into /workspace. Token goes in a one-off auth header (not the URL,
    // not .git/config); run under bash -c so the nix devshell PATH (BASH_ENV)
    // and bash-isms like $(...) are available.
    await sandbox.process.executeCommand(
      `bash -c 'BASIC=$(printf "x-access-token:%s" "$GITHUB_TOKEN" | base64 -w0) && ` +
        `git -c http.extraHeader="Authorization: Basic $BASIC" clone --depth 1 ${opts.repoUrl} /workspace'`,
    )

    // Start the ACP sidecar in the background. bash -c so it inherits the
    // devshell PATH, otherwise the sidecar's Bun.spawn(['opencode']) can't
    // find opencode.
    await sandbox.process.createSession('sidecar')
    await sandbox.process.executeSessionCommand('sidecar', {
      command: `bash -c 'exec /opt/acp-sidecar'`,
      runAsync: true,
    })

    // Poll the sidecar's readiness probe instead of guessing with a delay.
    await waitForSidecar(sandbox)

    return new DaytonaSandbox(sandbox.id, this.daytona)
  }

  async get(id: string): Promise<AgentSandbox> {
    return new DaytonaSandbox(id, this.daytona)
  }
}
