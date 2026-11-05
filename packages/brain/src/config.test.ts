import { assertEquals, assertThrows } from '@std/assert';
import { ConfigError, loadConfig } from './config.ts';

Deno.test('loadConfig reads every value and derives the gateway hosts', () => {
  const env: Record<string, string> = {
    MACRO_API_KEY: 'mak_test',
    MACRO_GATEWAY: 'https://dev-gateway.macro.com/',
    BRAIN_WORKSPACE: '/home/ada/workspace',
    BRAIN_HEALTH_PORT: '7801',
    ANTHROPIC_BASE_URL: 'https://gateway.example/anthropic',
    ANTHROPIC_AUTH_TOKEN: 'token',
  };

  const config = loadConfig((name) => env[name]);

  assertEquals(config.healthPort, 7801);
  assertEquals(config.hosts, {
    storage: 'https://dev-gateway.macro.com/dss',
    auth: 'https://dev-gateway.macro.com/auth',
    cognition: 'https://dev-gateway.macro.com/cognition',
    agentHarness: 'https://dev-gateway.macro.com/agent-harness',
    scheduledAction: 'https://dev-gateway.macro.com/scheduled-action',
    connection: 'wss://dev-gateway.macro.com/connection-gateway/',
  });
});

Deno.test('loadConfig names every missing variable at once', () => {
  const env: Record<string, string> = {
    MACRO_API_KEY: 'mak_test',
    BRAIN_HEALTH_PORT: '7801',
  };

  assertThrows(
    () => loadConfig((name) => env[name]),
    ConfigError,
    'missing environment: MACRO_GATEWAY, BRAIN_WORKSPACE, ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN'
  );
});
