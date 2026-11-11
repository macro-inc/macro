// Runtime adapters supplied by the supervisor, separate from agent composition.
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SpanExporter } from '@opentelemetry/sdk-trace-base';
import { anthropicRelay } from './anthropic-relay.ts';
import type { BrainDeps } from './brain.ts';
import { MacroCodeMode } from './code-mode.ts';
import { loadConfig } from './config.ts';
import { MacroHttp } from './macro.ts';
import { openGatewaySocket, stayOnline } from './presence.ts';
import { AgentSdkRunner } from './runner.ts';
import { macroSdk, sdkRoutines, sdkTasks } from './sdk.ts';
import { initTelemetry, tracedFetch } from './telemetry.ts';
import { gitCli } from './workspace.ts';
export async function runtimeDeps(
  env: (name: string) => string | undefined,
  exporter?: SpanExporter
): Promise<BrainDeps> {
  const config = loadConfig(env);
  await initTelemetry(env, exporter);
  const http = new MacroHttp(
    config.hosts,
    config.macroApiKey,
    tracedFetch(fetch)
  );
  const macro = macroSdk(config.hosts, config.macroApiKey);
  const codeMode = new MacroCodeMode(config);
  const baseEnv: Record<string, string> = {};
  for (const name of ['PATH', 'HOME', 'LANG', 'TZ']) {
    const value = env(name);
    if (value) baseEnv[name] = value;
  }

  const relay = await anthropicRelay(
    config.anthropicBaseUrl,
    config.anthropicAuthToken
  );
  return {
    dispose: () => relay.close(),
    config: {
      workspace: config.workspace,
      healthPort: config.healthPort,
      gateway: config.gateway,
      hosts: config.hosts,
      anthropicBaseUrl: config.anthropicBaseUrl,
    },
    presence: () =>
      stayOnline({
        url: config.hosts.connection,
        apiKey: config.macroApiKey,
        open: openGatewaySocket,
        log: (line) => console.error(JSON.stringify(line)),
      }),
    http,
    tasks: sdkTasks(macro),
    routines: sdkRoutines(macro),
    runner: new AgentSdkRunner({
      query,
      macroTools: (signal) => codeMode.connect(signal),
      claudeExecutable: 'claude',
      anthropic: relay.access,
      claudeConfigDir: `${config.workspace}/cache/claude`,
      baseEnv,
    }),
    git: gitCli(config.workspace, env),
    exe: config.executable,
    baseEnv,
    log: (line) =>
      console.error(JSON.stringify({ at: new Date().toISOString(), ...line })),
  };
}
