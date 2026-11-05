// Child entrypoint. The supervisor supplies a frozen import map and a cleared env.

import type { Composition } from './mod.ts';
import * as library from './mod.ts';

// Preload the installed library in the static entry graph before importing agent code.
void library;

import { pathToFileURL } from 'node:url';
import { dryRun } from './dry-run.ts';
import { runtimeDeps } from './runtime.ts';
import { shutdownTelemetry } from './telemetry.ts';
import { stdioExporter } from './telemetry-relay.ts';

const [mode, entry, workspace] = Deno.args;
if (!entry || !workspace)
  throw new Error('host needs mode, entry and workspace');
const credentials: Record<string, string> =
  mode === 'check'
    ? {}
    : JSON.parse(await new Response(Deno.stdin.readable).text());
const readEnv = (name: string): string | undefined => {
  if (credentials[name] !== undefined) return credentials[name];
  try {
    return Deno.env.get(name);
  } catch (error) {
    if (error instanceof Deno.errors.NotCapable) return undefined;
    throw error;
  }
};
const deps =
  mode === 'check'
    ? undefined
    : await runtimeDeps(
        readEnv,
        readEnv('BRAIN_TELEMETRY') === '1' ? stdioExporter : undefined
      );
const module: { default: Composition } = await import(
  pathToFileURL(entry).href
);
if (typeof module.default !== 'function')
  throw new Error('brain.ts must default-export a Composition');
if (mode === 'check') {
  await dryRun(module.default, workspace);
} else {
  const stop = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    Deno.addSignalListener(signal, () => stop.abort());
  try {
    if (!deps) throw new Error('missing runtime adapters');
    const brain = await module.default(deps);
    await brain.run(stop.signal);
  } finally {
    await shutdownTelemetry();
  }
}
