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
import { createSignal, Show } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AgentInviteSource, InviteAgentForm } from './invite-agent-form';
import { AgentStatusPill, TeamAgentMenu } from './team-agent-row';

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('scrollTo', vi.fn());
});
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
    expect(screen.getByText('80 GB disk')).toBeTruthy();
    expect(screen.getByText('320 GB disk')).toBeTruthy();
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
it('updates setup progress to health status without adding billing labels or row actions', () => {
  const [value, setValue] = createSignal<TeamAgent>(agent);
  render(() => <AgentStatusPill agent={value()} />);
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe(
    '2'
  );
  setValue({ ...agent, setup: { step: 'connecting', position: 4, total: 5 } });
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe(
    '3'
  );
  setValue({ ...agent, status: 'running' });
  expect(screen.queryByRole('progressbar')).toBeNull();
  expect(screen.getByRole('status').textContent).toBe('Alive');
  setValue({
    ...agent,
    status: 'unhealthy',
    statusReason: 'Connection unavailable',
  });
  expect(screen.getByRole('status').textContent).toBe('Dead');
  setValue({ ...agent, status: 'failed', payment: 'comped', retryable: true });
  expect(screen.getByRole('status').textContent).toContain('Setting up…');
  expect(screen.queryByRole('button')).toBeNull();
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
  expect(screen.getAllByText('100 GB disk')).toHaveLength(3);
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

it('does not close a new invitation when an old create finishes after rollout revocation', async () => {
  let finish: (() => void) | undefined;
  const created = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const create = vi.fn(() => created);
  const close = vi.fn();
  const [enabled, setEnabled] = createSignal(true);
  render(() => (
    <Show when={enabled()}>
      <InviteAgentForm
        teamId="team-1"
        open
        onClose={close}
        size="standard"
        setSize={() => {}}
        source={source({ create })}
      />
    </Show>
  ));
  fill();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and invite' }));
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  setEnabled(false);
  setEnabled(true);
  fireEvent.input(screen.getByLabelText('Name'), {
    target: { value: 'New invitation' },
  });
  finish?.();
  await created;
  await Promise.resolve();
  await Promise.resolve();
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe(
    'New invitation'
  );
});

it('enforces the server character limits before reviewing a draft, including Unicode names', () => {
  render(() => (
    <InviteAgentForm
      teamId="team-1"
      open
      onClose={() => {}}
      size="standard"
      setSize={() => {}}
      source={source()}
    />
  ));
  const name = screen.getByLabelText('Name');
  const role = screen.getByLabelText('Role / job description');
  const personality = screen.getByLabelText('Personality');
  fireEvent.input(name, { target: { value: '🙂'.repeat(64) } });
  fireEvent.input(role, { target: { value: 'r'.repeat(4000) } });
  fireEvent.input(personality, { target: { value: 'p'.repeat(4000) } });
  const review = screen.getByRole('button', { name: 'Review price' });
  expect(review.hasAttribute('disabled')).toBe(false);
  fireEvent.input(name, { target: { value: 'n'.repeat(65) } });
  expect(review.hasAttribute('disabled')).toBe(true);
  fireEvent.input(name, { target: { value: 'Assistant' } });
  fireEvent.input(role, { target: { value: 'r'.repeat(4001) } });
  expect(review.hasAttribute('disabled')).toBe(true);
  fireEvent.input(role, { target: { value: 'Engineer' } });
  fireEvent.input(personality, { target: { value: 'p'.repeat(4001) } });
  expect(review.hasAttribute('disabled')).toBe(true);
});

it('shows no retired payment step or diagnostic to non-admins', () => {
  const [value, setValue] = createSignal<TeamAgent>({
    ...agent,
    payment: 'pending',
    setup: undefined,
  });
  render(() => <AgentStatusPill agent={value()} />);
  expect(screen.getByRole('progressbar').getAttribute('aria-valuetext')).toBe(
    'Setting up…'
  );
  expect(screen.queryByText(/Paying|Confirming payment/)).toBeNull();
  setValue({
    ...agent,
    payment: 'unbilled',
    status: 'failed',
    statusReason: 'payment failed',
  });
  expect(screen.getByRole('status').textContent).toContain('Setting up…');
  expect(screen.queryByRole('link', { name: 'Billing' })).toBeNull();
  expect(screen.queryByText(/payment failed/)).toBeNull();
});

it('gives admins a plain failed-invitation sentence and a Billing link', () => {
  const openBilling = vi.fn();
  render(() => (
    <AgentStatusPill
      agent={{ ...agent, payment: 'unbilled', status: 'failed' }}
      canManage
      onOpenBilling={openBilling}
    />
  ));
  expect(
    screen.getByText("Couldn't add Assistant: payment didn't go through")
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('link', { name: 'Billing' }));
  expect(openBilling).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Unbilled')).toBeNull();
});
