// Runtime adapters supplied by the supervisor, separate from agent composition.
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SpanExporter } from '@opentelemetry/sdk-trace-base';
import { z } from 'zod';
import type { BrainDeps } from './brain.ts';
import { SpeechGateway } from './calls/speech.ts';
import { callTransport } from './calls/transport.ts';
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

  const rings = new Map<string, number>();
  const speechBase = config.anthropicBaseUrl.replace(
    /\/anthropic\/?$/,
    '/inference'
  );
  if (speechBase === config.anthropicBaseUrl)
    throw new Error('brain Anthropic URL must end in /anthropic');
  const gatewayMessage = z.object({ type: z.string(), data: z.unknown() });
  const callMessage = z.object({ call_id: z.string() });

  return {
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
        onMessage(data) {
          try {
            const envelope = gatewayMessage.parse(
              typeof data === 'string' ? JSON.parse(data) : data
            );
            if (
              !['call_started', 'call_ended', 'call_declined'].includes(
                envelope.type
              )
            )
              return;
            const call = callMessage.parse(
              typeof envelope.data === 'string'
                ? JSON.parse(envelope.data)
                : envelope.data
            );
            if (envelope.type === 'call_started')
              rings.set(call.call_id, Date.now());
            else rings.delete(call.call_id);
          } catch {
            console.error(JSON.stringify({ calls: 'invalid_notification' }));
          }
        },
      }),
    calls: callTransport({
      workspace: config.workspace,
      http,
      gateway: new SpeechGateway(speechBase, config.macroApiKey, 'Agent'),
      ringing: () => {
        for (const [id, time] of rings)
          if (Date.now() - time > 60000) rings.delete(id);
        return new Set(rings.keys());
      },
      emit: (type) => console.error(JSON.stringify({ calls: type })),
      modelOptions: {
        pathToClaudeCodeExecutable: 'claude',
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        env: {
          ...baseEnv,
          ANTHROPIC_BASE_URL: config.anthropicBaseUrl,
          ANTHROPIC_AUTH_TOKEN: config.anthropicAuthToken,
          CLAUDE_CONFIG_DIR: `${config.workspace}/cache/claude`,
        },
      },
    }),
    http,
    tasks: sdkTasks(macro),
    routines: sdkRoutines(macro),
    runner: new AgentSdkRunner({
      query,
      macroTools: (signal) => codeMode.connect(signal),
      claudeExecutable: 'claude',
      anthropicBaseUrl: config.anthropicBaseUrl,
      anthropicAuthToken: config.anthropicAuthToken,
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
