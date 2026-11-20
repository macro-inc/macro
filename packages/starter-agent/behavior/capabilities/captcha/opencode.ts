/**
 * The solver's one OpenCode run: Kimi K3 on Fireworks, reached through the
 * agent's relay and the harness's `/brain/fireworks` route (so no Fireworks
 * key is here), with the `captcha` MCP server as its only tools. Nothing
 * else of OpenCode's is on: no shell, files, web, subagents, skills or
 * plugins, and none of the computer's own OpenCode configuration.
 */
import { mcpVariables } from './mcp.ts';

/** The model, by Fireworks' id; the harness allows only this one. */
export const solverModel = 'accounts/fireworks/models/kimi-k3';
/** OpenCode's name for the provider the relay serves. */
const provider = 'macro';
/** The agent OpenCode runs as: the only one, with only the captcha tools. */
export const solverAgent = 'captcha';
/** The relay's path to the harness's Fireworks route, as OpenAI's base URL. */
export const fireworksRoute = 'brain/fireworks/v1';
/** Most model turns one run takes. */
export const mostSteps = 8;
/** How long the MCP server may take on one call: a solve polls for up to two minutes. */
const toolTimeoutMs = 150_000;
/** Most tokens one model turn writes. */
const mostOutput = 2048;

const prompt = `You clear the human check (CAPTCHA) on the agent's current browser tab, using only your two tools.
1. Call solve_captcha.
2. If it answers unsolvable, timeout or stillChallenged, call solve_captcha once more. Otherwise stop.
Never do anything else. Reply with one line: the last outcome.`;

/** What the run is asked: the reason is for the log only, so a page's text never reaches the prompt. */
export const task = 'Clear the human check on the current tab.';

export type RunPlace = {
  readonly relay: { readonly url: string; readonly token: string };
  readonly browser: string;
  readonly solveId: string;
  /** The MCP server's entry: this module's `mcp.ts`. */
  readonly server: string;
  /** Where the server appends each attempt's outcome. */
  readonly record: string;
  /** The harness's take-over file, which the server checks before touching the page. */
  readonly screenDriver: string;
  /** How to start Bun for the server. */
  readonly bun: string;
  /** The run's span: the MCP server's spans and the harness's model spans join it. */
  readonly traceparent?: string;
  /** The agent's opaque telemetry id, and where spans are exported (the OTel variables). */
  readonly telemetry: {
    readonly agentId: string;
    readonly environment: Readonly<Record<string, string>>;
  };
};

/** The whole OpenCode configuration, passed inline so no file of the computer's is read. */
export const openCodeConfig = (place: RunPlace) => {
  const base = place.relay.url.replace(/\/+$/, '');
  const model = `${provider}/${solverModel}`;
  return {
    $schema: 'https://opencode.ai/config.json',
    autoupdate: false,
    share: 'disabled',
    snapshot: false,
    subagent_depth: 0,
    enabled_providers: [provider],
    provider: {
      [provider]: {
        npm: '@ai-sdk/openai-compatible',
        name: 'Macro',
        options: {
          baseURL: `${base}/${fireworksRoute}`,
          apiKey: place.relay.token,
          ...(place.traceparent === undefined
            ? {}
            : { headers: { traceparent: place.traceparent } }),
        },
        models: {
          [solverModel]: {
            name: 'Kimi K3',
            tool_call: true,
            limit: { context: 131_072, output: mostOutput },
          },
        },
      },
    },
    model,
    small_model: model,
    default_agent: solverAgent,
    agent: {
      [solverAgent]: {
        mode: 'primary',
        model,
        prompt,
        steps: mostSteps,
        permission: { '*': 'deny', 'captcha_*': 'allow' },
      },
      build: { disable: true },
      plan: { disable: true },
      general: { disable: true },
      explore: { disable: true },
      title: { disable: true },
      summary: { disable: true },
    },
    tools: { '*': false, 'captcha_*': true },
    mcp: {
      captcha: {
        type: 'local',
        command: [place.bun, place.server],
        timeout: toolTimeoutMs,
        environment: {
          [mcpVariables.relayUrl]: place.relay.url,
          [mcpVariables.relayToken]: place.relay.token,
          [mcpVariables.browser]: place.browser,
          [mcpVariables.solveId]: place.solveId,
          [mcpVariables.record]: place.record,
          [mcpVariables.screenDriver]: place.screenDriver,
          [mcpVariables.agentId]: place.telemetry.agentId,
          ...place.telemetry.environment,
          ...(place.traceparent === undefined
            ? {}
            : { [mcpVariables.traceparent]: place.traceparent }),
        },
      },
    },
  };
};

/**
 * OpenCode's own switches: nothing fetched, nothing of the computer's read
 * (its config, Claude Code's, skills, plugins), and its state kept in `home`,
 * the run's own directory.
 */
export const openCodeEnvironment = (
  place: RunPlace,
  home: string,
  join: (...parts: readonly string[]) => string
): Record<string, string> => ({
  OPENCODE_CONFIG_CONTENT: JSON.stringify(openCodeConfig(place)),
  OPENCODE_DISABLE_MODELS_FETCH: '1',
  OPENCODE_DISABLE_PROJECT_CONFIG: '1',
  OPENCODE_DISABLE_CLAUDE_CODE: '1',
  OPENCODE_DISABLE_DEFAULT_PLUGINS: '1',
  OPENCODE_DISABLE_EXTERNAL_SKILLS: '1',
  OPENCODE_DISABLE_AUTOUPDATE: '1',
  OPENCODE_DISABLE_LSP_DOWNLOAD: '1',
  OPENCODE_DISABLE_SHARE: '1',
  XDG_CONFIG_HOME: join(home, 'config'),
  XDG_DATA_HOME: join(home, 'data'),
  XDG_CACHE_HOME: join(home, 'cache'),
  XDG_STATE_HOME: join(home, 'state'),
});

/**
 * The command line, after the sandbox prefix. `timeout` runs inside the
 * sandbox and stops OpenCode itself (which stops its MCP server) at the
 * limit: a kill of the sandbox from outside would leave them running.
 */
export const openCodeArgv = (limitMs: number): readonly string[] => [
  'timeout',
  '--kill-after=10s',
  `${Math.ceil(limitMs / 1000)}s`,
  'opencode',
  'run',
  '--agent',
  solverAgent,
  task,
];
