import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ServiceName } from './config';

type LocalPortmap = {
  version: 1;
  webAppUrl: string;
  hosts: Partial<Record<ServiceName, string>>;
};

const portmapName = 'portmap.json';

/** Load a generated local-stack port map, if one is available. */
export function resolveLocalPortmap(
  localPortmapPath?: string,
): LocalPortmap | undefined {
  const configuredPath = localPortmapPath ?? process.env.MACRO_LOCAL_PORTMAP;
  const path = configuredPath ?? findPortmap();
  if (!path || !existsSync(path)) return undefined;

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
  const instance = process.env.MACRO_LOCAL_INSTANCE ?? 'macro';
  let directory = process.cwd();
  while (true) {
    const path = join(
      directory,
      'infra',
      'local',
      'generated',
      instance,
      portmapName,
    );
    if (existsSync(path)) return path;

    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
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

  const hosts: Partial<Record<ServiceName, string>> = {};
  for (const [name, url] of Object.entries(portmap.hosts)) {
    if (isServiceName(name) && typeof url === 'string') hosts[name] = url;
  }
  return { version: 1, webAppUrl: portmap.webAppUrl, hosts };
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
