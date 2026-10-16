import { cleanup, fireEvent, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithFakeOnboarding } from '../tests/render';
import { ToolsStep } from './tools-step';

afterEach(cleanup);

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
