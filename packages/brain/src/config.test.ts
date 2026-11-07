import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigError, loadConfig } from './config.ts';
import { runtimeDeps } from './runtime.ts';

const environment: Record<string, string> = {
  MACRO_API_KEY: 'mak_test',
  MACRO_GATEWAY: 'https://gateway.example',
  OVERRIDE_DOCUMENT_STORAGE_SERVICE_URL: 'https://storage.example/custom/',
  OVERRIDE_AUTH_SERVICE_URL: 'https://auth.example/session',
  OVERRIDE_DOCUMENT_COGNITION_SERVICE_URL: 'http://127.0.0.1:8101/cognition',
  OVERRIDE_AGENT_HARNESS_SERVICE_URL: 'https://harness.example',
  OVERRIDE_SCHEDULED_ACTION_SERVICE_URL: 'https://schedule.example/tasks',
  OVERRIDE_MCP_SERVICE_URL: 'https://tools.example/service///',
  OVERRIDE_CONNECTION_GATEWAY_WEBSOCKET_URL: 'wss://presence.example/socket',
  BRAIN_WORKSPACE: '/home/agent/workspace',
  BRAIN_HEALTH_PORT: '7801',
  BRAIN_EXECUTABLE: '/opt/macro/brain',
  ANTHROPIC_BASE_URL: 'https://gateway.example/anthropic',
  ANTHROPIC_AUTH_TOKEN: 'token',
};

test('loadConfig uses explicit canonical service URLs instead of deriving gateway routes', () => {
  const config = loadConfig((name) => environment[name]);
  assert.equal(config.healthPort, 7801);
  assert.deepEqual(config.hosts, {
    storage: 'https://storage.example/custom',
    auth: 'https://auth.example/session',
    cognition: 'http://127.0.0.1:8101/cognition',
    agentHarness: 'https://harness.example',
    scheduledAction: 'https://schedule.example/tasks',
    mcp: 'https://tools.example/service',
    connection: 'wss://presence.example/socket',
  });
});

test('each service URL is required even when a gateway origin is supplied', () => {
  for (const key of Object.keys(environment).filter((name) =>
    name.startsWith('OVERRIDE_')
  )) {
    const env = { ...environment };
    delete env[key];
    assert.throws(
      () => loadConfig((name) => env[name]),
      (error: unknown) =>
        error instanceof ConfigError && error.message.includes(key)
    );
  }
});

test('loadConfig names every missing variable at once', () => {
  assert.throws(
    () => loadConfig(() => undefined),
    (error: unknown) =>
      error instanceof ConfigError &&
      Object.keys(environment).every((key) => error.message.includes(key))
  );
});

test('loadConfig refuses missing, noninteger and out-of-range health ports', () => {
  for (const port of ['', '0', '-1', '65536', '1.5', 'not-a-port']) {
    const env: Record<string, string> = {
      ...environment,
      BRAIN_HEALTH_PORT: port,
    };
    assert.throws(() => loadConfig((name) => env[name]), /BRAIN_HEALTH_PORT/);
  }
});

test('runtime keeps service URLs and bootstrap credentials out of turn environments', async () => {
  const env: Record<string, string> = {
    ...environment,
    PATH: '/usr/bin',
    HOME: '/home/agent',
    MACRO_REPO_TOKEN: 'repo-test-token',
    NODE_OPTIONS: '--inspect',
  };
  const deps = await runtimeDeps((name) => env[name]);
  assert.equal(deps.config.hosts.mcp, 'https://tools.example/service');
  assert.deepEqual(deps.baseEnv, {
    PATH: '/usr/bin',
    HOME: '/home/agent',
  });
});
