// The brain's process configuration, from the environment only. A missing or
// malformed value fails startup with the variable's name.
/** Base URLs of the Macro services the brain calls, without trailing slash. */
export type Hosts = {
  storage: string;
  auth: string;
  cognition: string;
  agentHarness: string;
  scheduledAction: string;
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
/** Every service under a gateway origin, at the gateway's path prefixes. */
export function gatewayHosts(gateway: string): Hosts {
  const base = gateway.replace(/\/+$/, '');
  const socket = base.replace(/^http/, 'ws');
  return {
    storage: `${base}/dss`,
    auth: `${base}/auth`,
    cognition: `${base}/cognition`,
    agentHarness: `${base}/agent-harness`,
    scheduledAction: `${base}/scheduled-action`,
    connection: `${socket}/connection-gateway/`,
  };
}
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
    hosts: gatewayHosts(gateway),
    workspace,
    healthPort,
    executable,
    anthropicBaseUrl,
    anthropicAuthToken,
  };
}
