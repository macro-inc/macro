/**
 * @vitest-environment jsdom
 */

import { ThrownResultError } from '@core/util/result';
import type { ComputerStatus, SizeOffer } from '@service-auth/computers';
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { For } from 'solid-js';
import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { MacroComputers } from './MacroComputers';

const mocks = vi.hoisted(() => ({
  rollout: true,
  offers: [] as SizeOffer[],
  computers: [] as ComputerStatus[],
  release: vi.fn(),
  toastFailure: vi.fn(),
  purchase: vi.fn(),
  notify: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('@queries/computers/computers', () => ({
  useComputerOffersQuery: () => ({
    isPending: false,
    isError: false,
    isSuccess: true,
    get data() {
      return mocks.offers;
    },
  }),
  usePurchaseComputerMutation: () => ({
    mutateAsync: mocks.purchase,
    isPending: false,
  }),
  useNotifyComputerSizeMutation: () => ({
    mutateAsync: mocks.notify,
    isPending: false,
    variables: undefined,
  }),
  useSetComputerPowerMutation: () => ({ isPending: false }),
  useCancelComputerMutation: () => ({ isPending: false }),
  useUndoCancelComputerMutation: () => ({ isPending: false }),
  useReleaseComputerMutation: () => ({
    isPending: false,
    mutateAsync: mocks.release,
  }),
}));

vi.mock('@queries/agents/agents', () => ({
  useAgentsQuery: () => ({ isSuccess: true, data: [] }),
}));

vi.mock('@queries/computers/claude', () => ({
  useClaudeModeQuery: () => ({ isSuccess: false }),
  useClaudeSignOutMutation: () => ({ isPending: false }),
}));

vi.mock('./computer-setup-dialog', () => ({
  ComputerSetupSteps: () => null,
  StepHeader: () => null,
  computerConnected: () => false,
}));

vi.mock('@queries/harnesses/harnesses', () => ({
  useHarnessesQuery: () => ({ isSuccess: true, data: [] }),
}));

vi.mock('./claude-sign-in-dialog', () => ({
  ClaudeSignInDialog: () => null,
}));

// The menu's own rendering is the design system's; these tests cover which
// items a computer offers.
vi.mock('../components/computer-actions-menu', () => ({
  ComputerActionsMenu: (props: {
    items: { label: string; onSelect: () => void }[];
  }) => (
    <For each={props.items}>
      {(item) => (
        <button type="button" role="menuitem" onClick={item.onSelect}>
          {item.label}
        </button>
      )}
    </For>
  ),
}));

vi.mock('../primitives/team-computers', () => ({
  useTeamComputers: () => ({
    enabled: () => true,
    canPurchase: () => mocks.rollout,
    computers: () => mocks.computers,
    failed: () => false,
  }),
}));

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: mocks.rollout, loading: false }),
}));

vi.mock('@core/context/user', () => ({ useUserId: () => () => 'viewer' }));

vi.mock('@core/user', () => ({
  getDisplayNameParts: () => ({
    firstName: 'Maya',
    lastName: '',
    fullName: '',
  }),
  tryMacroId: (id: string) => id,
}));

vi.mock('@queries/team/teams', () => ({
  useIsTeamAdmin: () => () => true,
  useIsTeamOwner: () => () => true,
}));

vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: mocks.toastSuccess, failure: mocks.toastFailure },
}));

beforeAll(() => {
  vi.stubGlobal('scrollTo', vi.fn());
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rollout = true;
  mocks.computers = [];
  mocks.offers = [
    {
      size: 'standard',
      vcpus: 2,
      memoryGb: 8,
      diskGb: 64,
      quote: {
        size: 'standard',
        priceId: 'price_standard',
        amount: 4000,
        currency: 'usd',
        interval: 'month',
      },
      soldOut: false,
      notifyRequested: false,
    },
    {
      size: 'large',
      vcpus: 4,
      memoryGb: 16,
      diskGb: 128,
      quote: {
        size: 'large',
        priceId: 'price_large',
        amount: 8000,
        currency: 'usd',
        interval: 'month',
      },
      soldOut: false,
      notifyRequested: false,
    },
    {
      size: 'xl',
      vcpus: 8,
      memoryGb: 32,
      diskGb: 256,
      quote: {
        size: 'xl',
        priceId: 'price_xl',
        amount: 16000,
        currency: 'usd',
        interval: 'month',
      },
      soldOut: true,
      notifyRequested: false,
    },
  ];
});

it('buys the chosen size after confirming its price, and keeps sold-out sizes out of reach', async () => {
  mocks.purchase
    .mockRejectedValueOnce(
      new ThrownResultError([
        { code: 'SOLD_OUT', message: 'That size just sold out.' },
      ])
    )
    .mockResolvedValueOnce({ computerId: 'computer-1' });
  mocks.notify.mockResolvedValue({});

  render(() => <MacroComputers harnesses={[]} onSharingChange={() => {}} />);

  fireEvent.click(screen.getByRole('button', { name: 'Get a computer' }));
  await screen.findByText('Get a Macro computer', { selector: 'h2' });
  expect(screen.getByRole('radio', { name: 'XL' })).toHaveProperty(
    'disabled',
    true
  );

  fireEvent.click(screen.getByRole('button', { name: 'Notify me' }));
  await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith('xl'));

  fireEvent.click(screen.getByRole('radio', { name: 'Large' }));
  const buyButton = screen.getByRole('button', { name: 'Buy · $80.00/month' });

  fireEvent.click(buyButton);
  expect((await screen.findByRole('alert')).textContent).toBe(
    'That size just sold out.'
  );
  expect(mocks.purchase).toHaveBeenNthCalledWith(1, {
    size: 'large',
    name: "Maya's Agent Box",
  });

  fireEvent.input(screen.getByLabelText('Name'), {
    target: { value: '  Build machine  ' },
  });
  fireEvent.click(buyButton);
  await waitFor(() =>
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      'Computer purchased. Provisioning now.'
    )
  );
  expect(mocks.purchase).toHaveBeenNthCalledWith(2, {
    size: 'large',
    name: 'Build machine',
  });
});

it('removes a failed payment with the stored confirmation name and allows retry after an error', async () => {
  mocks.computers = [
    {
      id: 'computer-1',
      name: 'Build machine',
      size: 'standard',
      vcpus: 4,
      memoryGib: 8,
      diskGib: 100,
      catalogEntry: 'standard@2026-11',
      status: 'payment_failed',
      payment: 'unbilled',
      poweredOn: false,
      createdAt: '2026-01-01T00:00:00Z',
    },
  ];
  mocks.release
    .mockRejectedValueOnce(new Error('Request failed'))
    .mockResolvedValueOnce({});

  render(() => <MacroComputers harnesses={[]} onSharingChange={() => {}} />);

  const remove = screen.getByRole('menuitem', { name: 'Remove' });
  fireEvent.click(remove);
  await waitFor(() =>
    expect(mocks.toastFailure).toHaveBeenCalledWith(
      "Couldn't remove the computer. Try again."
    )
  );
  expect(mocks.release).toHaveBeenNthCalledWith(1, {
    computerId: 'computer-1',
    confirmName: 'Build machine',
  });

  fireEvent.click(remove);
  await waitFor(() =>
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Build machine removed')
  );
  expect(mocks.release).toHaveBeenNthCalledWith(2, {
    computerId: 'computer-1',
    confirmName: 'Build machine',
  });
});

it('keeps existing computers and release available with rollout off while hiding purchase', async () => {
  mocks.rollout = false;
  mocks.computers = [
    {
      id: 'computer-1',
      name: 'Build machine',
      size: 'standard',
      vcpus: 4,
      memoryGib: 8,
      diskGib: 100,
      catalogEntry: 'standard@2026-11',
      status: 'ready',
      payment: 'paid',
      poweredOn: true,
      createdAt: '2026-01-01T00:00:00Z',
    },
  ];
  render(() => <MacroComputers harnesses={[]} onSharingChange={() => {}} />);
  expect(screen.getByText('Build machine')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Get a computer' })).toBeNull();
  expect(
    screen.getByRole('menuitem', { name: 'Cancel at period end' })
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Release now' }));
  expect(await screen.findByLabelText(/Type/)).toBeTruthy();
});

it('keeps a zero-price offer included through review and purchase', async () => {
  mocks.offers[0].quote.amount = 0;
  render(() => <MacroComputers harnesses={[]} onSharingChange={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Get a computer' }));
  await screen.findByRole('radio', { name: 'Standard' });
  expect(screen.getAllByText('Included').length).toBeGreaterThan(0);
  expect(screen.queryByText(/\$0\.00/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Buy' }));
  await waitFor(() =>
    expect(mocks.purchase).toHaveBeenCalledWith({
      size: 'standard',
      name: "Maya's Agent Box",
    })
  );
});

it('offers Finish setup before Claude sign-in, and nothing once both are done', () => {
  const harness = {
    id: 'harness-build',
    name: 'Build machine',
    kind: 'macrod' as const,
    owner: { type: 'user' as const, user_id: 'viewer' },
    access: 'owner' as const,
    shared_team_ids: [],
    created_by: 'viewer',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    connected: true,
    last_connected_at: null,
    allow_permission_bypass: true,
    computer_id: 'computer-1',
    claude_mode: 'own_account' as const,
    capabilities: { claude: { status: 'signed_out' as const } },
  };
  const computer: ComputerStatus = {
    id: 'computer-1',
    name: 'Build machine',
    size: 'standard',
    vcpus: 4,
    memoryGib: 8,
    diskGib: 100,
    catalogEntry: 'standard@2026-11',
    status: 'ready',
    payment: 'paid',
    poweredOn: true,
    createdAt: '2026-01-01T00:00:00Z',
    harnessId: 'harness-build',
    setupCompletedAt: null,
  };
  mocks.computers = [computer];
  const first = render(() => (
    <MacroComputers harnesses={[harness]} onSharingChange={() => {}} />
  ));
  expect(screen.getByRole('button', { name: 'Finish setup' })).toBeTruthy();
  expect(
    screen.queryByRole('button', { name: 'Sign in with Claude' })
  ).toBeNull();
  first.unmount();

  mocks.computers = [{ ...computer, setupCompletedAt: '2026-01-02T00:00:00Z' }];
  const second = render(() => (
    <MacroComputers harnesses={[harness]} onSharingChange={() => {}} />
  ));
  expect(
    screen.getByRole('button', { name: 'Sign in with Claude' })
  ).toBeTruthy();
  second.unmount();

  render(() => (
    <MacroComputers
      harnesses={[{ ...harness, claude_mode: 'macro_credits' }]}
      onSharingChange={() => {}}
    />
  ));
  expect(
    screen.queryByRole('button', { name: 'Sign in with Claude' })
  ).toBeNull();
  expect(screen.queryByRole('button', { name: 'Finish setup' })).toBeNull();
  expect(screen.getByText(/Claude: Macro credits/)).toBeTruthy();
});
