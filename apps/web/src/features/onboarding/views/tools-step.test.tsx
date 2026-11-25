import { cleanup, fireEvent, screen, waitFor } from '@solidjs/testing-library';
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
  it('keeps Drive and Sheets available, hides excluded Google apps, and re-enables held connections', async () => {
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
        connectors: [{ slug: 'linear', status: 'disabled' }],
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

it('holds connecting while connection status is unknown and offers retry', () => {
  const { fake } = renderWithFakeOnboarding(
    () => <ToolsStep onContinue={vi.fn()} />,
    {
      connectorsFail: true,
      catalog: [
        { slug: 'github', name: 'GitHub', iconUrl: null },
        { slug: 'stripe', name: 'Stripe', iconUrl: null },
      ],
    }
  );
  for (const name of ['GitHub', 'Stripe'])
    expect(
      (
        screen.getByRole('button', {
          name: `Connect ${name}`,
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
  fireEvent.click(
    screen.getByRole('button', { name: 'Retry connection status' })
  );
  expect(fake.calls()).toContain('retryConnections');
});
it('offers repository setup once GitHub is connected', () => {
  const { fake } = renderWithFakeOnboarding(
    () => <ToolsStep onContinue={vi.fn()} />,
    { connectors: [{ slug: 'github', status: 'connected' }] }
  );
  expect(
    screen.getByRole('button', { name: 'Connected to GitHub' })
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
      connectors: [{ slug: 'linear', status: 'connected' }],
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
    { connectors: [{ slug: 'github', status: 'connected' }] }
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
