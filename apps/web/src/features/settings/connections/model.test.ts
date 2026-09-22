import type { PipedreamConnectionResponse } from '@service-cognition/client';
import type { ServerResponse } from '@service-cognition/generated/schemas';
import { describe, expect, it } from 'vitest';
import { isConnectionsEmpty, toConnectionsModel } from './model';

const pipedream = (
  app_slug: string,
  overrides: Partial<PipedreamConnectionResponse> = {}
): PipedreamConnectionResponse => ({
  app_slug,
  enabled: true,
  server_name: app_slug,
  ...overrides,
});

const native = (
  server_name: string,
  url: string,
  overrides: Partial<ServerResponse> = {}
): ServerResponse => ({
  server_name,
  url,
  authenticated: true,
  enabled: true,
  ...overrides,
});

const emptyInput = {
  pipedream: [],
  nativeMcp: [],
};

describe('toConnectionsModel', () => {
  it('is empty when nothing is connected', () => {
    const model = toConnectionsModel(emptyInput);
    expect(isConnectionsEmpty(model)).toBe(true);
    expect(model.providers).toEqual([]);
    expect(model.leftovers).toEqual([]);
  });

  it('does not map a native server by name alone', () => {
    const model = toConnectionsModel({
      ...emptyInput,
      nativeMcp: [native('Linear', 'https://example.com/mcp')],
    });
    expect(model.capabilities.find((row) => row.id === 'linear-ai')).toBe(
      undefined
    );
    expect(model.leftovers).toEqual([
      {
        kind: 'native-mcp',
        id: 'mcp:https://example.com/mcp',
        title: 'Linear',
        subtitle: 'example.com/mcp',
        url: 'https://example.com/mcp',
        enabled: true,
        authenticated: true,
      },
    ]);
  });

  it('previews host and path and drops query params', () => {
    const model = toConnectionsModel({
      ...emptyInput,
      nativeMcp: [
        native('Kody', 'https://kody.codes/mcp?token=secret'),
        native('Bare', 'https://tools.example/'),
      ],
    });
    expect(model.leftovers.map((row) => row.subtitle)).toEqual([
      'kody.codes/mcp',
      'tools.example',
    ]);
  });

  it('keeps a second curated native URL as a leftover', () => {
    const model = toConnectionsModel({
      ...emptyInput,
      nativeMcp: [
        native('Linear', 'https://mcp.linear.app/mcp'),
        native('Linear copy', 'https://mcp.linear.app/mcp/extra'),
      ],
    });
    expect(
      model.capabilities.find((row) => row.id === 'linear-ai')?.sourceUrl
    ).toBe('https://mcp.linear.app/mcp');
    expect(model.leftovers.map((row) => row.title)).toEqual(['Linear copy']);
  });

  it('maps Pipedream Linear to one AI capability with Off', () => {
    const model = toConnectionsModel({
      ...emptyInput,
      pipedream: [pipedream('linear', { enabled: false })],
    });
    expect(
      model.capabilities.find((row) => row.id === 'linear-ai')
    ).toMatchObject({
      status: 'off',
      mechanism: 'pipedream',
    });
    expect(model.providers.find((row) => row.id === 'linear')?.ready).toBe(0);
    expect(model.providers.find((row) => row.id === 'linear')?.accounts).toBe(
      ''
    );
  });

  it('keeps a leftover native GitHub MCP when Pipedream GitHub already maps', () => {
    const model = toConnectionsModel({
      ...emptyInput,
      pipedream: [pipedream('github')],
      nativeMcp: [
        native('GitHub', 'https://api.githubcopilot.com/mcp'),
        native('Unknown', 'https://example.com/mcp'),
      ],
    });
    expect(model.leftovers.map((row) => row.title)).toEqual([
      'GitHub',
      'Unknown',
    ]);
  });

  it('maps a lone native Linear server onto the curated capability', () => {
    const model = toConnectionsModel({
      ...emptyInput,
      nativeMcp: [native('Linear', 'https://mcp.linear.app/mcp')],
    });
    expect(
      model.capabilities.find((row) => row.id === 'linear-ai')
    ).toMatchObject({
      mechanism: 'native-mcp',
      status: 'connected',
    });
    expect(model.leftovers).toEqual([]);
  });
});
