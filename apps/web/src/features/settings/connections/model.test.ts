import type { GithubLink } from '@queries/auth';
import type { PipedreamConnectionResponse } from '@service-cognition/client';
import type { ServerResponse } from '@service-cognition/generated/schemas';
import type { Link as EmailLink } from '@service-email/generated/schemas';
import { describe, expect, it } from 'vitest';
import { isConnectionsEmpty, toConnectionsModel } from './model';

const link = (id: string, overrides: Partial<EmailLink> = {}): EmailLink =>
  ({
    id,
    macro_id: 'macro|self',
    email_address: `${id}@macro.com`,
    needs_calendar_permission: false,
    calendar_disabled: false,
    has_calendar_data: true,
    is_primary: false,
    needs_reauth: false,
    ...overrides,
  }) as unknown as EmailLink;

const github = (overrides: Partial<GithubLink> = {}): GithubLink => ({
  status: 'linked',
  username: 'cameronpak',
  ...overrides,
});

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
  userId: 'macro|self',
  emailEnabled: true,
  calendarEnabled: true,
  emailLinks: [],
  github: github({ status: 'unlinked', username: undefined }),
  pipedream: [],
  nativeMcp: [],
  cursorRegistered: false,
};

describe('toConnectionsModel', () => {
  it('is empty when nothing is connected', () => {
    const model = toConnectionsModel(emptyInput);
    expect(isConnectionsEmpty(model)).toBe(true);
    expect(model.providers).toEqual([]);
    expect(model.leftovers).toEqual([]);
  });

  it('splits Gmail and Calendar per inbox and marks shared inboxes', () => {
    const model = toConnectionsModel({
      ...emptyInput,
      emailLinks: [
        link('cam', {
          email_address: 'cam@macro.com',
          needs_calendar_permission: true,
        }),
        link('team', {
          email_address: 'team@lunchflow.com',
          macro_id: 'macro|other',
        }),
      ],
    });
    const google = model.providers.find((row) => row.id === 'google');
    expect(google).toMatchObject({
      ready: 3,
      total: 4,
      summary: 'Calendar needs a grant for cam@macro.com',
    });
    expect(
      model.capabilities.find((row) => row.id === 'gmail:team')?.scope
    ).toBe('shared');
    expect(
      model.capabilities.find((row) => row.id === 'calendar:cam')?.status
    ).toBe('not-connected');
  });

  it('treats a disabled calendar as not connected', () => {
    const model = toConnectionsModel({
      ...emptyInput,
      emailLinks: [
        link('cam', {
          email_address: 'cam@macro.com',
          calendar_disabled: true,
        }),
      ],
    });
    expect(
      model.capabilities.find((row) => row.id === 'calendar:cam')?.status
    ).toBe('not-connected');
    expect(model.providers.find((row) => row.id === 'google')?.summary).toBe(
      'Calendar needs a grant for cam@macro.com'
    );
  });

  it('does not invent a Docs capability', () => {
    const model = toConnectionsModel({
      ...emptyInput,
      emailLinks: [link('cam')],
    });
    expect(model.capabilities.some((row) => row.title.includes('Docs'))).toBe(
      false
    );
  });

  it('shows GitHub reconnect without counting the unproven team app', () => {
    const model = toConnectionsModel({
      ...emptyInput,
      github: github({ status: 'reauthentication_required' }),
      pipedream: [pipedream('github')],
    });
    const githubProvider = model.providers.find((row) => row.id === 'github');
    expect(githubProvider).toMatchObject({
      ready: 1,
      total: 3,
      summary: 'GitHub account needs reconnect',
    });
    expect(
      model.capabilities.find((row) => row.id === 'github-team')?.status
    ).toBe('not-connected');
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
  });

  it('keeps a leftover native GitHub MCP when Pipedream GitHub already maps', () => {
    const model = toConnectionsModel({
      ...emptyInput,
      github: github(),
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

  it('lists Cursor only when the key is registered', () => {
    expect(toConnectionsModel(emptyInput).providers).toEqual([]);
    const model = toConnectionsModel({
      ...emptyInput,
      cursorRegistered: true,
    });
    expect(model.providers.map((row) => row.id)).toEqual(['cursor']);
  });
});
