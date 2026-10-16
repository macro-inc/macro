import { describe, expect, it } from 'vitest';
import {
  onboardingConnectedTools,
  onboardingToolState,
} from './connected-tools';

describe('native onboarding connections', () => {
  it('merges native presets with Pipedream without relying on display names', () => {
    const native = [
      'https://api.githubcopilot.com/mcp',
      'https://mcp.linear.app/mcp/',
      'https://mcp.notion.com/mcp',
      'https://mcp.slack.com/mcp',
      'https://mcp.posthog.com/mcp',
      'https://mcp.datadoghq.com/mcp',
      'https://mcp.grafana.com/mcp',
    ].map((url) => ({
      url,
      enabled: true,
      authenticated: true,
      server_name: 'Renamed',
    }));
    expect(
      onboardingConnectedTools(new Set(['linear', 'hubspot']), native)
    ).toEqual(
      new Set([
        'linear',
        'notion',
        'slack',
        'posthog',
        'datadog',
        'grafana',
        'hubspot',
      ])
    );
  });

  it('does not mistake unauthenticated or unrelated servers for connected tools', () => {
    expect(
      onboardingConnectedTools(new Set(), [
        {
          url: 'https://mcp.linear.app/mcp',
          enabled: true,
          authenticated: false,
        },
        { url: 'https://example.com/mcp', enabled: true, authenticated: true },
        {
          url: 'https://mcp.notion.com.evil.example/mcp',
          enabled: true,
          authenticated: true,
        },
      ])
    ).toEqual(new Set());
  });

  it('normalizes Pipedream aliases', () => {
    expect(onboardingConnectedTools(new Set(['slack_v2']), [])).toEqual(
      new Set(['slack'])
    );
  });
  it('uses native account status for GitHub, never Pipedream or MCP status', () => {
    const mcp = [
      {
        url: 'https://api.githubcopilot.com/mcp',
        enabled: true,
        authenticated: true,
      },
    ];
    expect(
      onboardingConnectedTools(new Set(['github']), mcp, false).has('github')
    ).toBe(false);
    expect(onboardingConnectedTools(new Set(), [], true).has('github')).toBe(
      true
    );
  });
});

const loading = { t: 'loading' } as const;
const error = { t: 'error' } as const;
const empty = { t: 'ready', value: [] } as const;
it('isolates GitHub and hosted providers from unrelated status failures', () => {
  expect(
    onboardingToolState('github', error, error, { t: 'ready', value: 'linked' })
  ).toBe('account-linked');
  expect(onboardingToolState('stripe', empty, error, error)).toBe('available');
  expect(onboardingToolState('linear', empty, error, error)).toBe('error');
  expect(onboardingToolState('linear', loading, loading, error)).toBe(
    'loading'
  );
});
it('keeps known connections usable when the other source fails', () => {
  const native = {
    t: 'ready',
    value: [
      { url: 'https://mcp.linear.app/mcp', authenticated: true, enabled: true },
    ],
  } as const;
  expect(onboardingToolState('linear', error, native, error)).toBe('connected');
  expect(
    onboardingToolState(
      'slack',
      { t: 'ready', value: [{ app_slug: 'slack_v2', enabled: true }] },
      error,
      error
    )
  ).toBe('connected');
});
it('offers enable instead of OAuth for disabled existing connections', () => {
  expect(
    onboardingToolState(
      'linear',
      empty,
      {
        t: 'ready',
        value: [
          {
            url: 'https://mcp.linear.app/mcp',
            authenticated: true,
            enabled: false,
          },
        ],
      },
      error
    )
  ).toBe('disabled');
  expect(
    onboardingToolState(
      'stripe',
      { t: 'ready', value: [{ app_slug: 'stripe', enabled: false }] },
      empty,
      error
    )
  ).toBe('disabled');
});
