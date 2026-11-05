// Node child entrypoint. The supervisor supplies an exact installed library and cleared env.

import { pathToFileURL } from 'node:url';
import { dryRun } from './dry-run.ts';
import type { Composition } from './mod.ts';
import { runtimeDeps } from './runtime.ts';
import { stdinText } from './subprocess.ts';
import { shutdownTelemetry } from './telemetry.ts';
import { stdioExporter } from './telemetry-relay.ts';

const [mode, entry, workspace] = process.argv.slice(2);
if (!entry || !workspace)
  throw new Error('host needs mode, entry and workspace');
const credentials: Record<string, string> =
  mode === 'check' ? {} : JSON.parse(await stdinText());
const readEnv = (name: string): string | undefined =>
  credentials[name] ?? process.env[name];
const deps =
  mode === 'check'
    ? undefined
    : await runtimeDeps(
        readEnv,
        readEnv('BRAIN_TELEMETRY') === '1' ? stdioExporter : undefined
      );
const module: {
  default: Composition;
} = await import(pathToFileURL(entry).href);
if (typeof module.default !== 'function')
  throw new Error('brain.ts must default-export a Composition');
if (mode === 'check') {
  await dryRun(module.default, workspace);
} else {
  const stop = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.on(signal, () => stop.abort());
  try {
    if (!deps) throw new Error('missing runtime adapters');
    const brain = await module.default(deps);
    await brain.run(stop.signal);
  } finally {
    await shutdownTelemetry();
  }
}
