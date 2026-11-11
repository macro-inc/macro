// The brain's process configuration, from the environment only. A missing or
// malformed value fails startup with the variable's name.
/** Base URLs of the Macro services the brain calls, without trailing slash. */
export type Hosts = {
  storage: string;
  auth: string;
  cognition: string;
  agentHarness: string;
  scheduledAction: string;
  /** MCP service base; the bridge appends /mcp. */
  mcp: string;
  /** The connection gateway websocket (presence). */
  connection: string;
};
export type Config = {
  macroApiKey: string;
  gateway: string;
  hosts: Hosts;
  workspace: string;
  healthPort: number;
  executable: string;
  anthropicBaseUrl: string;
  anthropicAuthToken: string;
};
/** Canonical override names exported by macro_service_urls ServiceUrl types. */
export const SERVICE_URL_ENV = {
  storage: 'OVERRIDE_DOCUMENT_STORAGE_SERVICE_URL',
  auth: 'OVERRIDE_AUTH_SERVICE_URL',
  cognition: 'OVERRIDE_DOCUMENT_COGNITION_SERVICE_URL',
  agentHarness: 'OVERRIDE_AGENT_HARNESS_SERVICE_URL',
  scheduledAction: 'OVERRIDE_SCHEDULED_ACTION_SERVICE_URL',
  mcp: 'OVERRIDE_MCP_SERVICE_URL',
  connection: 'OVERRIDE_CONNECTION_GATEWAY_WEBSOCKET_URL',
} as const;
export class ConfigError extends Error {}
/** Read the configuration from `env`. Throws a `ConfigError` naming every missing variable. */
export function loadConfig(env: (name: string) => string | undefined): Config {
  const missing: string[] = [];
  const required = (name: string) => {
    const value = env(name)?.trim();
    if (!value) {
      missing.push(name);
      return '';
    }
    return value;
  };
  const serviceUrl = (name: string, websocket = false): string => {
    const value = required(name);
    if (!value) return value;
    try {
      const protocol = new URL(value).protocol;
      const allowed = websocket ? ['ws:', 'wss:'] : ['http:', 'https:'];
      if (!allowed.includes(protocol)) throw new Error('invalid protocol');
    } catch {
      throw new ConfigError(
        `${name} must be an ${websocket ? 'ws(s)' : 'http(s)'} URL`
      );
    }
    return websocket ? value : value.replace(/\/+$/, '');
  };
  const hosts: Hosts = {
    storage: serviceUrl(SERVICE_URL_ENV.storage),
    auth: serviceUrl(SERVICE_URL_ENV.auth),
    cognition: serviceUrl(SERVICE_URL_ENV.cognition),
    agentHarness: serviceUrl(SERVICE_URL_ENV.agentHarness),
    scheduledAction: serviceUrl(SERVICE_URL_ENV.scheduledAction),
    mcp: serviceUrl(SERVICE_URL_ENV.mcp),
    connection: serviceUrl(SERVICE_URL_ENV.connection, true),
  };
  const macroApiKey = required('MACRO_API_KEY');
  const gateway = required('MACRO_GATEWAY');
  const workspace = required('BRAIN_WORKSPACE');
  const port = required('BRAIN_HEALTH_PORT');
  const executable = required('BRAIN_EXECUTABLE');
  const anthropicBaseUrl = required('ANTHROPIC_BASE_URL');
  const anthropicAuthToken = required('ANTHROPIC_AUTH_TOKEN');
  if (missing.length > 0) {
    throw new ConfigError(`missing environment: ${missing.join(', ')}`);
  }
  const healthPort = Number(port);
  if (!Number.isInteger(healthPort) || healthPort < 1 || healthPort > 65535) {
    throw new ConfigError(
      `BRAIN_HEALTH_PORT must be a port number, got ${JSON.stringify(port)}`
    );
  }
  if (!/^https?:\/\//.test(gateway)) {
    throw new ConfigError(
      `MACRO_GATEWAY must be an http(s) origin, got ${JSON.stringify(gateway)}`
    );
  }
  return {
    macroApiKey,
    gateway,
    hosts,
    workspace,
    healthPort,
    executable,
    anthropicBaseUrl,
    anthropicAuthToken,
  };
}
