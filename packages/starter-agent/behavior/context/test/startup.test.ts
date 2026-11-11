import { describe, expect, test } from 'bun:test';
import { addresses } from '../addresses.ts';
import { runFiles, startup } from '../startup.ts';

const reserved = ['agent'];

describe('startup', () => {
  test('a hosted agent reads its credentials from the file it is given', () => {
    expect(
      startup(
        {
          AGENT_WORKSPACE: '/home/macro/agent/workspace',
          MUPPET_CREDENTIALS_FILE:
            '/run/credentials/macro-agent.service/agent.env',
        },
        reserved
      )
    ).toEqual({
      kind: 'configured',
      value: {
        workspace: '/home/macro/agent/workspace',
        credentials: {
          kind: 'file',
          file: '/run/credentials/macro-agent.service/agent.env',
        },
        mcpServers: {},
        sandbox: [],
      },
    });
  });

  test('a self-hosted agent keeps SOPS when it asks for it', () => {
    expect(
      startup({ AGENT_WORKSPACE: '/w', MUPPET_CREDENTIALS: 'sops' }, reserved)
    ).toMatchObject({
      kind: 'configured',
      value: { credentials: { kind: 'sops' } },
    });
  });

  test("a script's process reaches Macro through the agent's relay, with names and no values", () => {
    expect(
      startup(
        {
          AGENT_WORKSPACE: '/w',
          MUPPET_RELAY_URL: 'http://127.0.0.1:4000',
          MUPPET_RELAY_TOKEN: 'capability',
          MUPPET_CREDENTIAL_NAMES: 'MACRO_API_KEY,OTHER',
        },
        reserved
      )
    ).toMatchObject({
      kind: 'configured',
      value: {
        credentials: {
          kind: 'relayed',
          url: 'http://127.0.0.1:4000',
          token: 'capability',
          names: ['MACRO_API_KEY', 'OTHER'],
        },
      },
    });
  });

  test('names the variable that is missing', () => {
    expect(startup({ MUPPET_CREDENTIALS_FILE: '/f' }, reserved)).toEqual({
      kind: 'invalid',
      message: 'AGENT_WORKSPACE is not set',
    });
    expect(startup({ AGENT_WORKSPACE: '/w' }, reserved)).toEqual({
      kind: 'invalid',
      message: 'MUPPET_CREDENTIALS_FILE is not set',
    });
    expect(
      startup({ AGENT_WORKSPACE: '/w', MUPPET_CREDENTIALS: 'vault' }, reserved)
    ).toMatchObject({
      kind: 'invalid',
      message: expect.stringContaining('MUPPET_CREDENTIALS'),
    });
    expect(
      startup(
        { AGENT_WORKSPACE: '/w', MUPPET_RELAY_URL: 'http://127.0.0.1:1' },
        reserved
      )
    ).toEqual({ kind: 'invalid', message: 'MUPPET_RELAY_TOKEN is not set' });
  });

  test('adds the stdio MCP servers it is given', () => {
    expect(
      startup(
        {
          AGENT_WORKSPACE: '/w',
          MUPPET_CREDENTIALS_FILE: '/f',
          MUPPET_MCP_SERVERS_JSON: JSON.stringify({
            computer: {
              command: '/bin/computer-use-linux',
              args: ['--display', ':1'],
              env: { DISPLAY: ':1' },
            },
            bare: { command: 'bare-mcp' },
          }),
        },
        reserved
      )
    ).toMatchObject({
      kind: 'configured',
      value: {
        mcpServers: {
          computer: {
            type: 'stdio',
            command: '/bin/computer-use-linux',
            args: ['--display', ':1'],
            env: { DISPLAY: ':1' },
          },
          bare: { type: 'stdio', command: 'bare-mcp' },
        },
      },
    });
  });

  test('refuses MCP servers that are not JSON, the wrong shape, or shadow its own', () => {
    for (const json of [
      '{not json',
      JSON.stringify({ x: { args: [] } }),
      JSON.stringify({ agent: { command: 'impostor' } }),
    ]) {
      const configured = startup(
        {
          AGENT_WORKSPACE: '/w',
          MUPPET_CREDENTIALS_FILE: '/f',
          MUPPET_MCP_SERVERS_JSON: json,
        },
        reserved
      );
      expect(configured).toMatchObject({
        kind: 'invalid',
        message: expect.stringContaining('MUPPET_MCP_SERVERS_JSON'),
      });
    }
  });
});

describe('sandbox', () => {
  test('under systemd credentials, children run in bubblewrap with the credentials hidden', () => {
    const started = startup(
      {
        AGENT_WORKSPACE: '/w',
        MUPPET_CREDENTIALS_FILE:
          '/run/credentials/macro-agent.service/agent.env',
        CREDENTIALS_DIRECTORY: '/run/credentials/macro-agent.service',
      },
      reserved
    );
    expect(started.kind === 'configured' && started.value.sandbox).toEqual([
      'bwrap',
      '--dev-bind',
      '/',
      '/',
      '--tmpfs',
      '/run/credentials/macro-agent.service',
      '--',
    ]);
  });
});

describe('runFiles', () => {
  test('needs both files the launcher watches', () => {
    expect(
      runFiles({
        MUPPET_LAST_GOOD_FILE: '/s/last-good',
        MUPPET_RESTART_FILE: '/s/.restart',
      })
    ).toEqual({
      kind: 'configured',
      value: { lastGood: '/s/last-good', restart: '/s/.restart' },
    });
    expect(runFiles({ MUPPET_RESTART_FILE: '/r' })).toEqual({
      kind: 'invalid',
      message: 'MUPPET_LAST_GOOD_FILE is not set',
    });
    expect(runFiles({ MUPPET_LAST_GOOD_FILE: '/l' })).toEqual({
      kind: 'invalid',
      message: 'MUPPET_RESTART_FILE is not set',
    });
  });
});

describe('addresses', () => {
  const enrolled = {
    MACRO_API_KEY: 'mak_secret',
    MACRO_GATEWAY: 'https://dev-gateway.macro.com',
    OVERRIDE_DOCUMENT_STORAGE_SERVICE_URL: 'https://storage.internal/dss',
    OVERRIDE_AUTH_SERVICE_URL: 'https://auth.internal',
    OVERRIDE_DOCUMENT_COGNITION_SERVICE_URL: 'https://cognition.internal',
    OVERRIDE_AGENT_HARNESS_SERVICE_URL: 'https://harness.internal',
    OVERRIDE_SCHEDULED_ACTION_SERVICE_URL: 'https://scheduled.internal',
    OVERRIDE_CONNECTION_GATEWAY_WEBSOCKET_URL: 'wss://connection.internal/cg',
    OVERRIDE_MCP_SERVICE_URL: 'https://mcp.internal',
  };

  test("maps enrollment's service URLs onto the SDK's hosts, and the rest onto the gateway's routes", () => {
    expect(addresses(enrolled)).toEqual({
      kind: 'configured',
      value: {
        presence: 'wss://connection.internal/cg',
        hosts: {
          storage: 'https://storage.internal/dss',
          properties: 'https://storage.internal/dss',
          search: 'https://storage.internal/dss',
          auth: 'https://auth.internal',
          cognition: 'https://cognition.internal',
          'agent-harness': 'https://harness.internal',
          'scheduled-action': 'https://scheduled.internal',
          connection: 'https://connection.internal/cg',
          email: 'https://dev-gateway.macro.com/email',
          calendar: 'https://dev-gateway.macro.com/calendar',
          notification: 'https://dev-gateway.macro.com/notification',
          contacts: 'https://dev-gateway.macro.com/contacts',
          unfurl: 'https://dev-gateway.macro.com/unfurl',
        },
      },
    });
  });

  test('with only the gateway, every service is on its route there', () => {
    expect(
      addresses({ MACRO_GATEWAY: 'https://gateway.macro.com/' })
    ).toMatchObject({
      kind: 'configured',
      value: {
        presence: 'wss://gateway.macro.com/connection-gateway',
        hosts: {
          storage: 'https://gateway.macro.com/dss',
          connection: 'https://gateway.macro.com/connection-gateway',
          'agent-harness': 'https://gateway.macro.com/agent-harness',
        },
      },
    });
  });

  test('needs the gateway, and URLs that parse, naming the key and never a value', () => {
    expect(addresses({ MACRO_API_KEY: 'mak_secret' })).toEqual({
      kind: 'invalid',
      message: 'MACRO_GATEWAY is not in the credentials',
    });
    const bad = addresses({
      ...enrolled,
      OVERRIDE_AUTH_SERVICE_URL: 'not a url',
    });
    expect(bad).toEqual({
      kind: 'invalid',
      message: 'OVERRIDE_AUTH_SERVICE_URL is not a URL',
    });
  });
});
