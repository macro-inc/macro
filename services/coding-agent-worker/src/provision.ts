/** The idempotent script that turns a booted container into a ready sandbox,
 * shared by every provider. Providers implement only the CommandRunner
 * transport; the script is coupled to the container image (bash, the baked
 * nix devshells as BASH_ENV + /env/repo-dev-env.sh, /opt/acp-sidecar), not to
 * any provider. */

import type { CommandRunner } from './interfaces'

/** Macro dev shell baked into the image at build time (see the Dockerfile);
 * absent on images built without the github_token secret. */
const REPO_ENV_FILE = '/env/repo-dev-env.sh'
const SIDECAR_LOG = '/tmp/acp-sidecar.log'

export const WORKSPACE_DIR = '/workspace'

/** Clone + sidecar start; the dev env is prebaked so nothing builds here. */
export const ENSURE_TIMEOUT_S = 300

export function assertSafeRepoUrl(url: string): void {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    throw new Error(`invalid repoUrl: ${url}`)
  }
  if (u.protocol !== 'https:') throw new Error('repoUrl must be https')
  if (/[\s"'`$\\;|&<>()]/.test(url)) throw new Error('repoUrl contains illegal characters')
}

/** Bring the sandbox to "ready" no matter its current state; every stage
 * skips itself when already done, so this is safe to run on first boot,
 * reconnect, or after a machine restart.
 *
 * Reads REPO_URL and GITHUB_TOKEN from the sandbox environment (set at
 * creation) rather than interpolating them into the script.
 *
 * Stages: configure GitHub credentials, clone the repo, then start the sidecar
 * with the baked repo dev shell first on PATH and the base tools (opencode,
 * gh, github-mcp-server) still reachable. */
export function ensureReadyCommand(): string {
  return (
    `bash -c 'set -e; ` +
    `gh auth setup-git --hostname github.com --force; ` +
    `if [ ! -d ${WORKSPACE_DIR}/.git ]; then ` +
    `git clone --depth 1 "$REPO_URL" ${WORKSPACE_DIR}; ` +
    `fi; ` +
    `if ! curl -sf localhost:8700/ping >/dev/null 2>&1; then ` +
    `baked_path="$PATH"; ` +
    `if [ -f ${REPO_ENV_FILE} ]; then source ${REPO_ENV_FILE}; export PATH="$PATH:$baked_path"; fi; ` +
    `nohup /opt/acp-sidecar > ${SIDECAR_LOG} 2>&1 & ` +
    `fi'`
  )
}

export async function ensureReady(runner: CommandRunner): Promise<void> {
  console.log('[provision] ensuring sandbox is ready')
  await runner.run(ensureReadyCommand(), { timeoutS: ENSURE_TIMEOUT_S })
}

/** Poll the sidecar's readiness probe until it answers. */
export async function waitForPing(pingUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(pingUrl)
      if (res.ok) return
    } catch {
      // sidecar not up yet
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`sidecar did not answer ${pingUrl} within ${timeoutMs}ms`)
}
