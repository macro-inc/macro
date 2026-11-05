import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  readPendingConnectors,
  savePendingConnectors,
} from '../primitives/flow-storage';
import { renderWithFakeOnboarding } from '../tests/render';
import { ToolsStep } from './tools-step';

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

describe('onboarding tools', () => {
  it('keeps Drive and Sheets available, hides excluded Google apps, and reuses native connections', async () => {
    const { fake } = renderWithFakeOnboarding(
      () => <ToolsStep onContinue={vi.fn()} />,
      {
        catalog: [
          ['gmail', 'Gmail'],
          ['google_sheets', 'Google Sheets'],
          ['google_drive', 'Google Drive'],
          ['google_calendar', 'Google Calendar'],
          ['linear', 'Linear'],
          ['notion', 'Notion'],
        ].map(([slug, name]) => ({ slug, name, iconUrl: null })),
        nativeTools: [
          {
            url: 'https://mcp.linear.app/mcp/',
            authenticated: true,
            enabled: false,
            server_name: 'My issues',
          },
        ],
      }
    );
    for (const name of ['Gmail', 'Google Calendar']) {
      expect(
        screen.queryByRole('button', { name: `Connect ${name}` })
      ).toBeNull();
    }
    const linear = screen.getByRole('button', {
      name: 'Enable Linear',
    }) as HTMLButtonElement;
    expect(linear.disabled).toBe(false);
    fireEvent.click(linear);
    expect(fake.calls()).not.toContain('connectTool:linear');
    expect(
      screen.getByRole('button', { name: 'Connected to Linear' })
    ).toBeTruthy();
    await waitFor(() =>
      expect(
        (
          screen.getByRole('button', {
            name: 'Connect Notion',
          }) as HTMLButtonElement
        ).disabled
      ).toBe(false)
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Browse all integrations' })
    );
    fireEvent.input(screen.getByRole('searchbox'), {
      target: { value: 'Google' },
    });
    expect(
      screen.getAllByRole('button', { name: /Connect Google/ })
    ).toHaveLength(2);
    for (const name of ['Google Drive', 'Google Sheets']) {
      expect(
        (
          screen.getByRole('button', {
            name: `Connect ${name}`,
          }) as HTMLButtonElement
        ).disabled
      ).toBe(false);
    }
  });
});

it('keeps native GitHub available during hosted connection failures and offers retry', () => {
  const { fake } = renderWithFakeOnboarding(
    () => <ToolsStep onContinue={vi.fn()} />,
    {
      connectionFailures: ['pipedream'],
      catalog: [
        { slug: 'github', name: 'GitHub', iconUrl: null },
        { slug: 'stripe', name: 'Stripe', iconUrl: null },
      ],
    }
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Browse all integrations' })
  );
  expect(
    (
      screen.getByRole('button', {
        name: 'Connect GitHub',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(false);
  expect(
    (
      screen.getByRole('button', {
        name: 'Connect Stripe',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);
  fireEvent.click(
    screen.getByRole('button', { name: 'Retry connection status' })
  );
  expect(fake.calls()).toContain('retryConnections');
});
it('distinguishes a linked GitHub account from repository setup', () => {
  const { fake } = renderWithFakeOnboarding(
    () => <ToolsStep onContinue={vi.fn()} />,
    { githubLinkStatus: 'linked' }
  );
  expect(
    screen.getByRole('button', { name: 'Account linked to GitHub' })
  ).toBeTruthy();
  fireEvent.click(
    screen.getByRole('button', { name: 'Configure GitHub repositories' })
  );
  expect(fake.calls()).toContain('configureGithubRepositories');
});
it('tracks a connector once its connection lands, not ones already connected', async () => {
  const { fake } = renderWithFakeOnboarding(
    () => <ToolsStep onContinue={vi.fn()} />,
    {
      catalog: [
        { slug: 'linear', name: 'Linear', iconUrl: null },
        { slug: 'notion', name: 'Notion', iconUrl: null },
      ],
      connectedTools: ['linear'],
    }
  );
  fireEvent.click(screen.getByRole('button', { name: 'Connect Notion' }));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Connected to Notion' })
    ).toBeTruthy()
  );
  expect(
    fake
      .events()
      .filter((item) => item.event === 'onboarding_v4_connector_connected')
  ).toEqual([
    {
      event: 'onboarding_v4_connector_connected',
      data: { connector: 'notion' },
    },
  ]);
});
it('reports a GitHub connect that lands after the OAuth reload', async () => {
  // Web GitHub OAuth reloads the page, so the step remounts with the link.
  savePendingConnectors(new Set(['github']));
  const { fake } = renderWithFakeOnboarding(
    () => <ToolsStep onContinue={vi.fn()} />,
    { githubLinkStatus: 'linked' }
  );
  await waitFor(() =>
    expect(
      fake
        .events()
        .filter((item) => item.event === 'onboarding_v4_connector_connected')
    ).toEqual([
      {
        event: 'onboarding_v4_connector_connected',
        data: { connector: 'github' },
      },
    ])
  );
  expect(readPendingConnectors().size).toBe(0);
});
it('suggests the tools the inbox shows, with why, and always another inbox', async () => {
  const { fake } = renderWithFakeOnboarding(
    () => <ToolsStep onContinue={vi.fn()} />,
    {
      emailAccounts: [
        { address: 'ada@example.com', isPrimary: true, ownerId: 'macro|ada' },
      ],
      senderDomainCounts: { 'stripe.com': 31, 'posthog.com': 4 },
    }
  );
  const list = screen.getByRole('list', { name: 'Suggested connections' });
  expect(
    within(list)
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label'))
  ).toEqual([
    'Add another inbox',
    'Connect Stripe',
    'Connect PostHog',
    'Connect Slack',
    'Connect Linear',
  ]);
  expect(within(list).getAllByText('mcp')).toHaveLength(4);
  expect(
    within(list).getByText(
      'Import Linear issues into Macro tasks, and let agents create and update issues.'
    )
  ).toBeTruthy();
  expect(within(list).getByText('ada@example.com connected')).toBeTruthy();
  // Suggested tools aren't repeated in the full catalog.
  fireEvent.click(
    screen.getByRole('button', { name: 'Browse all integrations' })
  );
  expect(
    within(
      screen.getByRole('region', { name: 'Available integrations' })
    ).queryByRole('button', { name: 'Connect Linear' })
  ).toBeNull();
  fireEvent.keyDown(screen.getByRole('button', { name: 'Add another inbox' }), {
    key: 'Enter',
  });
  fireEvent.keyDown(await screen.findByRole('menuitem', { name: 'Outlook' }), {
    key: 'Enter',
  });
  await waitFor(() => expect(fake.calls()).toContain('connectInbox:OUTLOOK'));
});
it('suggests the defaults when the inbox check fails', () => {
  renderWithFakeOnboarding(() => <ToolsStep onContinue={vi.fn()} />, {
    failures: { senderDomainCounts: 'unavailable' },
  });
  expect(screen.getByRole('button', { name: 'Connect Slack' })).toBeTruthy();
});
