import type {
  TeamAgent,
  TeamAgentQuote,
} from '@service-auth/generated/schemas';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type AgentInviteSource, InviteAgentForm } from './invite-agent-form';
import { AgentStatusPill } from './team-agent-row';

afterEach(cleanup);
const quote: TeamAgentQuote = {
  seat: 2000,
  computer: 4000,
  total: 6000,
  currency: 'usd',
  interval: 'year',
};
function fill() {
  fireEvent.input(screen.getByLabelText('Name'), {
    target: { value: 'Assistant' },
  });
  fireEvent.input(screen.getByLabelText('Role / job description'), {
    target: { value: 'Maintain projects' },
  });
  fireEvent.input(screen.getByLabelText('Personality'), {
    target: { value: 'Concise' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Review price' }));
}
function source(overrides: Partial<AgentInviteSource> = {}): AgentInviteSource {
  return {
    quote: () => quote,
    quoteLoading: () => false,
    quoteError: () => false,
    pending: () => false,
    error: () => false,
    reloadQuote: vi.fn(),
    create: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('agent invite purchase', () => {
  it('requires review and a quote, preserves draft on Back, and submits once', async () => {
    let finish: (() => void) | undefined;
    const create = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    const close = vi.fn();
    render(() => (
      <InviteAgentForm
        open
        onClose={close}
        size="large"
        setSize={() => {}}
        source={source({ create })}
      />
    ));
    expect(
      screen
        .getByRole('button', { name: 'Review price' })
        .hasAttribute('disabled')
    ).toBe(true);
    fill();
    expect(create).not.toHaveBeenCalled();
    expect(screen.getByText('Total per year')).toBeTruthy();
    expect(screen.getByText('$60.00')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe(
      'Assistant'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Review price' }));
    const confirm = screen.getByRole('button', { name: 'Confirm and invite' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      name: 'Assistant',
      jobDescription: 'Maintain projects',
      personality: 'Concise',
      size: 'large',
      avatarUrl: undefined,
    });
    expect(close).not.toHaveBeenCalled();
    finish?.();
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  });

  it('blocks confirmation while the current quote fails, then recovers', () => {
    const [error, setError] = createSignal(true);
    const reload = vi.fn(() => setError(false));
    render(() => (
      <InviteAgentForm
        open
        onClose={() => {}}
        size="standard"
        setSize={() => {}}
        source={source({
          quote: () => (error() ? undefined : quote),
          quoteError: error,
          reloadQuote: reload,
        })}
      />
    ));
    fill();
    expect(
      screen
        .getByRole('button', { name: 'Confirm and invite' })
        .hasAttribute('disabled')
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(
      screen
        .getByRole('button', { name: 'Confirm and invite' })
        .hasAttribute('disabled')
    ).toBe(false);
  });

  it('retains the draft after a failed create and prevents an ambiguous second purchase', async () => {
    const create = vi.fn().mockRejectedValue(new Error('Connection lost'));
    render(() => (
      <InviteAgentForm
        open
        onClose={() => {}}
        size="standard"
        setSize={() => {}}
        source={source({ create })}
      />
    ));
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and invite' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'Check the members list'
      )
    );
    expect(
      screen
        .getByRole('button', { name: 'Confirm and invite' })
        .hasAttribute('disabled')
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe(
      'Assistant'
    );
  });
});

const agent: TeamAgent = {
  userId: 'agent-1',
  teamId: 'team-1',
  name: 'Assistant',
  email: 'agent@example.com',
  createdAt: '2026-01-01',
  status: 'provisioning',
  setup: { step: 'booting', position: 3, total: 5 },
};
it('updates setup to running and failed with the reason and retry action', () => {
  const [value, setValue] = createSignal(agent);
  const retry = vi.fn();
  render(() => <AgentStatusPill agent={value()} onRetry={retry} />);
  expect(screen.getByRole('status').textContent).toContain(
    'Starting computer (3/5)'
  );
  setValue({ ...agent, status: 'running' });
  expect(screen.getByRole('status').textContent).toContain('Running');
  expect(screen.queryByText('Starting computer (3/5)')).toBeNull();
  setValue({
    ...agent,
    status: 'failed',
    statusReason: 'Computer disconnected',
  });
  expect(screen.getByRole('status').textContent).toContain(
    'Computer disconnected'
  );
  fireEvent.click(screen.getByRole('button', { name: 'Retry status' }));
  expect(retry).toHaveBeenCalledTimes(1);
});
