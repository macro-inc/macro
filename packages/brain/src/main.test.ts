import assert from 'node:assert/strict';
import { test } from 'node:test';
import { closeHttp, httpPort, serveHttp } from './http.ts';
import { runCommand } from './subprocess.ts';

const environment = {
  MACRO_API_KEY: 'test-api-key',
  MACRO_GATEWAY: 'https://gateway.invalid',
  OVERRIDE_DOCUMENT_STORAGE_SERVICE_URL: 'https://storage.invalid',
  OVERRIDE_AUTH_SERVICE_URL: 'https://auth.invalid',
  OVERRIDE_DOCUMENT_COGNITION_SERVICE_URL: 'https://cognition.invalid',
  OVERRIDE_AGENT_HARNESS_SERVICE_URL: 'https://harness.invalid',
  OVERRIDE_SCHEDULED_ACTION_SERVICE_URL: 'https://schedule.invalid',
  OVERRIDE_MCP_SERVICE_URL: 'https://mcp.invalid',
  OVERRIDE_CONNECTION_GATEWAY_WEBSOCKET_URL: 'wss://connection.invalid',
  BRAIN_WORKSPACE: '/unused-workspace',
  BRAIN_EXECUTABLE: '/opt/macro/brain',
  ANTHROPIC_BASE_URL: 'https://gateway.invalid/anthropic',
  ANTHROPIC_AUTH_TOKEN: 'test-auth-token',
};

test('health CLI rejects invalid ports through the process config parser before fetching', async () => {
  for (const port of ['0', '65536', '1.5', 'not-a-port']) {
    const result = await runCommand(process.execPath, {
      args: [new URL('./main.ts', import.meta.url).pathname, 'health'],
      clearEnv: true,
      env: { ...environment, BRAIN_HEALTH_PORT: port },
    });
    assert.equal(result.code, 1);
    assert.match(
      new TextDecoder().decode(result.stderr),
      /BRAIN_HEALTH_PORT must be a port number/
    );
  }
});

test('health CLI probes the configured loopback port and returns the response status', async () => {
  const server = await serveHttp({ port: 0 }, () =>
    Response.json({ status: 'ok' })
  );
  try {
    const result = await runCommand(process.execPath, {
      args: [new URL('./main.ts', import.meta.url).pathname, 'health'],
      clearEnv: true,
      env: { ...environment, BRAIN_HEALTH_PORT: String(httpPort(server)) },
    });
    assert.equal(result.code, 0);
    assert.deepEqual(JSON.parse(new TextDecoder().decode(result.stdout)), {
      status: 'ok',
    });
  } finally {
    await closeHttp(server);
  }
});
