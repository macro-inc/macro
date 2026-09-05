import type { Stream } from '@agentclientprotocol/sdk';
import { createWebSocketStream } from '@agentclientprotocol/sdk/experimental/ws-client';
import { Daytona, Image, type Sandbox } from '@daytona/sdk';
import type {
  AgentSandbox,
  CommandRunner,
  SandboxProvider,
  SpawnOptions,
} from '../interfaces';
import { assertSafeRepoUrl, ensureReady, waitForPing } from '../provision';

const SIDECAR_PORT = 8700;

/** CommandRunner over a Daytona sandbox. */
class DaytonaRunner implements CommandRunner {
  constructor(private readonly sandbox: Sandbox) {}

  async run(command: string, opts?: { timeoutS?: number }): Promise<void> {
    const res = await this.sandbox.process.executeCommand(
      command,
      undefined,
      undefined,
      opts?.timeoutS
    );
    if (res.exitCode !== 0) {
      throw new Error(
        `sandbox command failed (exit ${res.exitCode}): ${command}\n${res.result}`
      );
    }
  }
}

class DaytonaSandbox implements AgentSandbox {
  constructor(
    readonly id: string,
    private readonly daytona: Daytona
  ) {}

  async ensure(): Promise<void> {
    const sandbox = await this.daytona.get(this.id);
    await ensureReady(new DaytonaRunner(sandbox));
    // Poll the sidecar's readiness probe instead of guessing with a delay.
    const preview = await sandbox.getSignedPreviewUrl(SIDECAR_PORT);
    await waitForPing(preview.url.replace(/\/$/, '') + '/ping', 60000);
  }

  async connect(): Promise<Stream> {
    const sandbox = await this.daytona.get(this.id);
    const preview = await sandbox.getSignedPreviewUrl(SIDECAR_PORT);
    return createWebSocketStream(preview.url.replace(/^http/, 'ws'));
  }

  /** No pooling on Daytona: releasing destroys. */
  async release(): Promise<void> {
    await this.destroy();
  }

  async destroy(): Promise<void> {
    const sandbox = await this.daytona.get(this.id);
    await sandbox.delete();
  }
}

export class DaytonaProvider implements SandboxProvider {
  private readonly daytona = new Daytona();

  async spawn(opts: SpawnOptions): Promise<AgentSandbox> {
    // Defense in depth: the url only travels as an env var, never
    // interpolated into a shell command, but reject junk at the boundary.
    assertSafeRepoUrl(opts.repoUrl);

    // The SDK uploads the Dockerfile's COPY sources before snapshot logs can
    // stream; that upload phase has no progress reporting.
    console.log('[daytona] uploading build context + creating sandbox');
    const created = await this.daytona.create(
      {
        image: Image.fromDockerfile('container/Dockerfile'),
        // REPO_URL rides in the sandbox env so ensure() needs no arguments
        // and reconnects don't have to rethread it.
        envVars: { ...opts.envVars, REPO_URL: opts.repoUrl },
        autoStopInterval: 0, // long-lived: we manage teardown explicitly
      },
      {
        timeout: 0,
        onSnapshotCreateLogs: (chunk) => process.stderr.write(chunk),
      }
    );
    console.log(`[daytona] sandbox ${created.id} created`);

    const sandbox = new DaytonaSandbox(created.id, this.daytona);
    await sandbox.ensure();
    return sandbox;
  }

  async get(id: string): Promise<AgentSandbox> {
    return new DaytonaSandbox(id, this.daytona);
  }
}
