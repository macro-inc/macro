import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ServiceName } from './config';

export type LocalPortmap = {
  webAppUrl: string;
  hosts: Partial<Record<ServiceName, string>>;
  sdkWebhookHostReceiverPort: number;
};

const portmapName = 'portmap.json';

/** Load a generated local-stack port map, if one is available. */
export function resolveLocalPortmap(): LocalPortmap | undefined {
  const path = findPortmap();
  if (!path) return undefined;

  try {
    return JSON.parse(readFileSync(path, 'utf8')) as LocalPortmap;
  } catch (error) {
    throw new Error(`failed to read Macro local port map ${path}`, {
      cause: error,
    });
  }
}

/** The repository root, or `undefined` outside a git checkout (or a runtime without processes). */
function repositoryRoot(): string | undefined {
  try {
    return execSync('git rev-parse --show-toplevel', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
}

function findPortmap(): string | undefined {
  const root = repositoryRoot();
  if (!root) return undefined;
  const generated = join(root, 'infra', 'local', 'generated');
  if (!existsSync(generated)) return undefined;

  for (const instance of readdirSync(generated)) {
    const path = join(generated, instance, portmapName);
    if (existsSync(path)) return path;
  }
  return undefined;
}
