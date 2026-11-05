import { ThrownResultError } from '@core/util/result';
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
import { AgentStatusPill, TeamAgentMenu } from './team-agent-row';

afterEach(cleanup);
const quote: TeamAgentQuote = {
  included: false,
  seat: 2000,
  computer: 4000,
  total: 6000,
  currency: 'usd',
  vcpus: 4,
  memoryGb: 16,
  diskGb: 100,
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
    specsForSize: (size) => ({ ...quote, size }),
    needsSubscription: () => false,
    quoteLoading: () => false,
    quoteError: () => false,
    pending: () => false,
    reloadQuote: vi.fn(),
    create: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('agent invite purchase', () => {
  it('shows each server specification and confirms the selected size quote', () => {
    const [size, setSize] = createSignal<'standard' | 'large' | 'xl'>(
      'standard'
    );
    const sizes = {
      standard: { ...quote, vcpus: 2, memoryGb: 8, diskGb: 80, total: 5000 },
      large: { ...quote, vcpus: 4, memoryGb: 16, diskGb: 160, total: 9000 },
      xl: { ...quote, vcpus: 8, memoryGb: 32, diskGb: 320, total: 15000 },
    };
    render(() => (
      <InviteAgentForm
        teamId="team-1"
        open
        onClose={() => {}}
        size={size()}
        setSize={setSize}
        source={source({
          specsForSize: (value) => ({ ...sizes[value], size: value }),
          quote: () => sizes[size()],
        })}
      />
    ));
    expect(screen.getByText('2 vCPUs · 8 GB RAM · 80 GB disk')).toBeTruthy();
    expect(screen.getByText('8 vCPUs · 32 GB RAM · 320 GB disk')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('XL'));
    fill();
    expect(screen.getByText('$150.00')).toBeTruthy();
  });

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
        teamId="team-1"
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
    expect(create).toHaveBeenCalledWith(
      {
        name: 'Assistant',
        jobDescription: 'Maintain projects',
        personality: 'Concise',
        size: 'large',
        expectedIncluded: false,
        avatarUrl: undefined,
      },
      expect.objectContaining({ run: expect.any(Function) })
    );
    expect(close).not.toHaveBeenCalled();
    finish?.();
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  });

  it('blocks confirmation while the current quote fails, then recovers', () => {
    const [error, setError] = createSignal(true);
    const reload = vi.fn(() => setError(false));
    render(() => (
      <InviteAgentForm
        teamId="team-1"
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
        teamId="team-1"
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
  retryable: false,
  payment: 'paid',
  setup: { step: 'booting', position: 3, total: 5 },
};
it.each(['paid', 'comped'] as const)(
  'updates %s setup to running and failed with the reason and retry action',
  (payment) => {
    const [value, setValue] = createSignal<TeamAgent>({ ...agent, payment });
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
      retryable: true,
      payment,
      statusReason: 'Computer disconnected',
    });
    expect(screen.getByRole('status').textContent).toContain(
      'Computer disconnected'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
  }
);

it.each(['paid', 'comped'] as const)(
  'withdraws provisioning retry when a %s agent becomes unhealthy and recovers without retry',
  (payment) => {
    const [value, setValue] = createSignal<TeamAgent>({
      ...agent,
      status: 'failed',
      retryable: true,
      payment,
    });
    const retry = vi.fn();
    render(() => <AgentStatusPill agent={value()} onRetry={retry} />);
    const previousRetry = screen.getByRole('button', { name: 'Retry' });
    setValue({
      ...value(),
      status: 'unhealthy',
      statusReason: 'Brain connection unavailable',
    });
    expect(screen.getByRole('status').textContent).toContain('Unhealthy');
    expect(screen.getByRole('status').textContent).toContain(
      'Brain connection unavailable'
    );
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    fireEvent.click(previousRetry);
    expect(retry).not.toHaveBeenCalled();
    setValue({ ...value(), status: 'running', statusReason: null });
    expect(screen.getByRole('status').textContent).toContain('Running');
    expect(screen.queryByText('Brain connection unavailable')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(retry).not.toHaveBeenCalled();
  }
);

it('keeps a payment failure reason visible without offering provisioning retry', () => {
  const retry = vi.fn();
  render(() => (
    <AgentStatusPill
      agent={{
        ...agent,
        status: 'failed',
        statusReason: 'payment failed',
        retryable: false,
        payment: 'unbilled',
      }}
      onRetry={retry}
    />
  ));
  expect(screen.getByRole('status').textContent).toContain('payment failed');
  expect(screen.getByText('Payment failed / not billed')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  expect(retry).not.toHaveBeenCalled();
});

it('shows payment progress and withdraws Retry when the server revokes it', () => {
  const [value, setValue] = createSignal<TeamAgent>({
    ...agent,
    status: 'failed',
    retryable: true,
    payment: 'paid',
  });
  const retry = vi.fn();
  render(() => <AgentStatusPill agent={value()} onRetry={retry} />);
  expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  setValue({
    ...agent,
    status: 'provisioning',
    retryable: false,
    setup: { step: 'paying', position: 1, total: 5 },
    payment: 'pending',
  });
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  expect(screen.getByRole('status').textContent).toContain(
    'Confirming payment'
  );
  expect(retry).not.toHaveBeenCalled();
});

it('labels a paid provisioning failure as billed and keeps unreadable payment unlabeled', () => {
  const [value, setValue] = createSignal<TeamAgent>({
    ...agent,
    payment: 'paid',
    status: 'failed',
    retryable: true,
  });
  render(() => <AgentStatusPill agent={value()} onRetry={() => {}} />);
  expect(screen.getByText('Billed')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  setValue({ ...agent, payment: null, status: 'failed', retryable: false });
  expect(screen.queryByText('Billed')).toBeNull();
  expect(screen.queryByText('Payment failed / not billed')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
});

it('blocks removal during pending payment and permits clean removal after an unbilled failure', async () => {
  const [value, setValue] = createSignal<TeamAgent>({
    ...agent,
    payment: 'pending',
  });
  const remove = vi.fn();
  render(() => <TeamAgentMenu agent={value()} onRemove={remove} />);
  fireEvent.keyDown(screen.getByRole('button', { name: 'More' }), {
    key: 'ArrowDown',
  });
  const item = await screen.findByRole('menuitem', { name: 'Remove agent' });
  expect(item.getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(item);
  expect(remove).not.toHaveBeenCalled();
  setValue({
    ...agent,
    payment: 'unbilled',
    status: 'failed',
    statusReason: 'payment failed',
  });
  const enabledItem = screen.getByRole('menuitem', { name: 'Remove agent' });
  expect(enabledItem.getAttribute('aria-disabled')).not.toBe('true');
  enabledItem.focus();
  fireEvent.keyDown(enabledItem, { key: 'Enter' });
  await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
});

it('keeps catalog specs visible without a subscription and directs admins to billing', () => {
  const create = vi.fn();
  render(() => (
    <InviteAgentForm
      teamId="team-1"
      open
      onClose={() => {}}
      size="standard"
      setSize={() => {}}
      source={source({
        quote: () => undefined,
        quoteError: () => true,
        needsSubscription: () => true,
        create,
      })}
    />
  ));
  expect(screen.getAllByText('4 vCPUs · 16 GB RAM · 100 GB disk')).toHaveLength(
    3
  );
  expect(screen.getByText(/Your team needs an active plan/)).toBeTruthy();
  expect(
    screen.getByRole('link', { name: 'Go to billing' }).getAttribute('href')
  ).toBe('/app/settings/billing');
  fill();
  expect(
    screen
      .getByRole('button', { name: 'Review price' })
      .hasAttribute('disabled')
  ).toBe(true);
  expect(screen.queryByText(/Couldn't load the price/)).toBeNull();
  expect(create).not.toHaveBeenCalled();
});

it('reviews an included quote without presenting a currency charge', async () => {
  const create = vi.fn().mockResolvedValue(undefined);
  render(() => (
    <InviteAgentForm
      teamId="team-1"
      open
      onClose={() => {}}
      size="standard"
      setSize={() => {}}
      source={source({
        quote: () => ({
          ...quote,
          included: true,
          seat: 0,
          computer: 0,
          total: 0,
        }),
        create,
      })}
    />
  ));
  fill();
  expect(screen.getByText('Included for Macro')).toBeTruthy();
  expect(screen.queryByText(/Total per/)).toBeNull();
  expect(screen.queryByText(/\$0\.00/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and invite' }));
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
});

it.each([
  [
    'repository_creation_failed',
    'The workspace repository service is missing git. Nothing was charged.',
    true,
  ],
  [
    'repository_creation_failed',
    'The workspace repository could not be created. Nothing was charged.',
    true,
  ],
  ['provider_failed', 'An unsafe provider detail', false],
])(
  'only shows the guaranteed pre-purchase server reason for %s',
  async (code, message, visible) => {
    const create = vi
      .fn()
      .mockRejectedValue(new ThrownResultError([{ code, message }]));
    render(() => (
      <InviteAgentForm
        teamId="team-1"
        open
        onClose={() => {}}
        size="standard"
        setSize={() => {}}
        source={source({ create })}
      />
    ));
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and invite' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toBe(
      visible
        ? message
        : "Couldn't confirm the invitation. Check the members list before trying again."
    );
    expect(
      screen
        .getByRole('button', { name: 'Confirm and invite' })
        .hasAttribute('disabled')
    ).toBe(true);
  }
);

it.each([true, false])(
  'keeps reviewed billing consent when included=%s changes and requires a new review',
  async (included) => {
    const [currentQuote, setCurrentQuote] = createSignal({
      ...quote,
      included,
      total: included ? 0 : quote.total,
    });
    const reloadQuote = vi.fn();
    const close = vi.fn();
    const create = vi
      .fn()
      .mockRejectedValueOnce(
        new ThrownResultError([
          {
            code: 'quote_changed',
            message:
              'The quote changed. Review the price again. Nothing was charged.',
          },
        ])
      )
      .mockResolvedValueOnce(undefined);
    render(() => (
      <InviteAgentForm
        teamId="team-1"
        open
        onClose={close}
        size="large"
        setSize={() => {}}
        source={source({ quote: currentQuote, create, reloadQuote })}
      />
    ));
    fill();
    setCurrentQuote({
      ...quote,
      included: !included,
      total: included ? quote.total : 0,
    });
    expect(!!screen.queryByText('Included for Macro')).toBe(included);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and invite' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        'The quote changed. Review the price again. Nothing was charged.'
      )
    );
    expect(create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ expectedIncluded: included }),
      expect.anything()
    );
    expect(close).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(reloadQuote).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe(
      'Assistant'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Review price' }));
    expect(!!screen.queryByText('Included for Macro')).toBe(!included);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and invite' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ expectedIncluded: !included }),
      expect.anything()
    );
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  }
);
