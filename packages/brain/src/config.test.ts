import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigError, loadConfig } from './config.ts';

test('loadConfig reads every value and derives the gateway hosts', () => {
  const env: Record<string, string> = {
    MACRO_API_KEY: 'mak_test',
    MACRO_GATEWAY: 'https://dev-gateway.macro.com/',
    BRAIN_WORKSPACE: '/home/ada/workspace',
    BRAIN_HEALTH_PORT: '7801',
    BRAIN_EXECUTABLE: '/opt/macro/brain',
    ANTHROPIC_BASE_URL: 'https://gateway.example/anthropic',
    ANTHROPIC_AUTH_TOKEN: 'token',
  };
  const config = loadConfig((name) => env[name]);
  assert.equal(config.mcpUrl, 'https://dev-gateway.macro.com/mcp/mcp');
  env.OVERRIDE_MCP_SERVICE_URL = 'http://127.0.0.1:8101/';
  assert.equal(
    loadConfig((name) => env[name]).mcpUrl,
    'http://127.0.0.1:8101/mcp'
  );
  assert.deepEqual(config.healthPort, 7801);
  assert.deepEqual(config.hosts, {
    storage: 'https://dev-gateway.macro.com/dss',
    auth: 'https://dev-gateway.macro.com/auth',
    cognition: 'https://dev-gateway.macro.com/cognition',
    agentHarness: 'https://dev-gateway.macro.com/agent-harness',
    scheduledAction: 'https://dev-gateway.macro.com/scheduled-action',
    connection: 'wss://dev-gateway.macro.com/connection-gateway/',
  });
});
test('loadConfig names every missing variable at once', () => {
  const env: Record<string, string> = {
    MACRO_API_KEY: 'mak_test',
    BRAIN_HEALTH_PORT: '7801',
  };
  assert.throws(
    () => loadConfig((name) => env[name]),
    (error: unknown) =>
      error instanceof ConfigError &&
      error.message.includes(
        'missing environment: MACRO_GATEWAY, BRAIN_WORKSPACE, BRAIN_EXECUTABLE, ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN'
      )
  );
});
