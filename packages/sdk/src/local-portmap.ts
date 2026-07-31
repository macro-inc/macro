import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ServiceName } from './config';

type LocalPortmap = {
  version: 1;
  webAppUrl: string;
  hosts: Partial<Record<ServiceName, string>>;
  sdkWebhookHostReceiverPort: number;
};

const portmapName = 'portmap.json';

/** Load a generated local-stack port map, if one is available. */
export function resolveLocalPortmap(): LocalPortmap | undefined {
  const path = findPortmap();
  if (!path) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`failed to read Macro local port map ${path}`, {
      cause: error,
    });
  }
  return parsePortmap(parsed, path);
}

function findPortmap(): string | undefined {
  const root = execSync('git rev-parse --show-toplevel', {
    encoding: 'utf8',
  }).trim();
  const generated = join(root, 'infra', 'local', 'generated');
  if (!existsSync(generated)) return undefined;

  for (const instance of readdirSync(generated)) {
    const path = join(generated, instance, portmapName);
    if (existsSync(path)) return path;
  }
  return undefined;
}

function parsePortmap(value: unknown, path: string): LocalPortmap {
  if (!value || typeof value !== 'object') {
    throw new Error(`invalid Macro local port map ${path}`);
  }
  const portmap = value as Record<string, unknown>;
  if (portmap.version !== 1 || typeof portmap.webAppUrl !== 'string') {
    throw new Error(`unsupported Macro local port map ${path}`);
  }
  if (!portmap.hosts || typeof portmap.hosts !== 'object') {
    throw new Error(`invalid Macro local port map hosts in ${path}`);
  }
  if (typeof portmap.sdkWebhookHostReceiverPort !== 'number') {
    throw new Error(
      `invalid Macro local port map sdkWebhookHostReceiverPort in ${path}`,
    );
  }

  const hosts: Partial<Record<ServiceName, string>> = {};
  for (const [name, url] of Object.entries(portmap.hosts)) {
    if (isServiceName(name) && typeof url === 'string') hosts[name] = url;
  }
  return {
    version: 1,
    webAppUrl: portmap.webAppUrl,
    hosts,
    sdkWebhookHostReceiverPort: portmap.sdkWebhookHostReceiverPort,
  };
}

function isServiceName(value: string): value is ServiceName {
  return [
    'storage',
    'auth',
    'email',
    'cognition',
    'notification',
    'properties',
    'search',
    'scheduled-action',
    'static-files',
    'connection',
    'contacts',
    'unfurl',
    'agent-proxy',
  ].includes(value as ServiceName);
}
