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
  offersError: undefined as unknown,
  openSettings: vi.fn(),
  computers: [] as ComputerStatus[],
  release: vi.fn(),
  restore: vi.fn(),
  confirm: vi.fn(),
  toastFailure: vi.fn(),
  purchase: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('@queries/computers/computers', () => ({
  useComputerOffersQuery: () => ({
    isPending: false,
    get isError() {
      return mocks.offersError !== undefined;
    },
    get isSuccess() {
      return mocks.offersError === undefined;
    },
    get error() {
      return mocks.offersError;
    },
    get data() {
      return mocks.offersError === undefined ? mocks.offers : undefined;
    },
  }),
  usePurchaseComputerMutation: () => ({
    mutateAsync: mocks.purchase,
    isPending: false,
  }),
  useSetComputerPowerMutation: () => ({ isPending: false }),
  useCancelComputerMutation: () => ({ isPending: false }),
  useUndoCancelComputerMutation: () => ({ isPending: false }),
  useRestoreComputerMutation: () => ({
    isPending: false,
    mutateAsync: mocks.restore,
  }),
  useReleaseComputerMutation: () => ({
    isPending: false,
    mutateAsync: mocks.release,
  }),
}));

vi.mock('@core/constant/SettingsState', () => ({
  useSettingsState: () => ({ openSettings: mocks.openSettings }),
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

vi.mock('@ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ui')>()),
  confirmDialog: mocks.confirm,
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
  mocks.offersError = undefined;
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
    },
  ];
});

it('buys the chosen size after confirming its price, and keeps sold-out sizes out of reach', async () => {
  mocks.purchase
    .mockRejectedValueOnce(
      new ThrownResultError([
        {
          code: 'PURCHASE_CONFLICT',
          message: 'That size just sold out.',
        },
      ])
    )
    .mockResolvedValueOnce({ computerId: 'computer-1', state: 'confirming' });

  render(() => <MacroComputers harnesses={[]} onSharingChange={() => {}} />);

  fireEvent.click(screen.getByRole('button', { name: 'Get a computer' }));
  await screen.findByText('Get a Macro computer', { selector: 'h2' });
  expect(screen.getByRole('radio', { name: 'XL' })).toHaveProperty(
    'disabled',
    true
  );

  expect(screen.getByText('Sold out')).toBeTruthy();

  fireEvent.click(screen.getByRole('radio', { name: 'Large' }));
  const buyButton = screen.getByRole('button', { name: 'Buy · $80.00/month' });

  fireEvent.click(buyButton);
  expect((await screen.findByRole('alert')).textContent).toBe(
    'That size just sold out.'
  );
  expect(mocks.purchase).toHaveBeenNthCalledWith(1, {
    purchaseKey: expect.any(String),
    size: 'large',
    name: "Maya's Agent Box",
  });

  fireEvent.input(screen.getByLabelText('Name'), {
    target: { value: '  Build machine  ' },
  });
  fireEvent.click(buyButton);
  await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledOnce());
  // The retry reuses the dialog's key, so it can never charge twice.
  expect(mocks.purchase).toHaveBeenNthCalledWith(2, {
    purchaseKey: mocks.purchase.mock.calls[0][0].purchaseKey,
    size: 'large',
    name: 'Build machine',
  });
});

it('offers Restore instead of Turn on for a released computer still kept, and confirms before billing again', async () => {
  const kept: ComputerStatus = {
    id: 'computer-1',
    name: 'Build machine',
    size: 'standard',
    vcpus: 4,
    memoryGib: 8,
    diskGib: 100,
    catalogEntry: 'standard@2026-11',
    status: 'stopped',
    billing: 'ended',
    poweredOn: false,
    agentCount: 0,
    canUndoCancel: false,
    canRestore: true,
    retainedUntil: '2026-12-01T00:00:00Z',
    purchasedBy: 'viewer',
    createdAt: '2026-01-01T00:00:00Z',
  };
  mocks.computers = [kept];
  mocks.confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  mocks.restore.mockResolvedValueOnce({ ...kept, billing: 'active' });

  render(() => <MacroComputers harnesses={[]} onSharingChange={() => {}} />);

  expect(
    screen.queryByRole('menuitem', { name: 'Cancel at period end' })
  ).toBeNull();
  expect(screen.queryByRole('menuitem', { name: 'Turn on' })).toBeNull();
  const restore = screen.getByRole('menuitem', { name: 'Restore' });
  fireEvent.click(restore);
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce());
  expect(mocks.restore).not.toHaveBeenCalled();

  fireEvent.click(restore);
  await waitFor(() => expect(mocks.restore).toHaveBeenCalledWith('computer-1'));
  expect(screen.getByRole('menuitem', { name: 'Release now' })).toBeTruthy();
});

it('offers no power, cancel or release while a purchase is being confirmed', () => {
  mocks.computers = [
    {
      id: 'computer-1',
      name: 'Build machine',
      size: 'standard',
      vcpus: 4,
      memoryGib: 8,
      diskGib: 100,
      catalogEntry: 'standard@2026-11',
      status: 'purchasing',
      billing: 'purchasing',
      setup: { step: 'creating', position: 1, total: 4 },
      poweredOn: false,
      agentCount: 0,
      canUndoCancel: false,
      canRestore: false,
      purchasedBy: 'viewer',
      createdAt: '2026-01-01T00:00:00Z',
    },
  ];

  render(() => <MacroComputers harnesses={[]} onSharingChange={() => {}} />);

  expect(screen.queryAllByRole('menuitem')).toEqual([]);
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
      billing: 'active',
      poweredOn: true,
      agentCount: 0,
      canUndoCancel: false,
      canRestore: false,
      purchasedBy: 'viewer',
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
      purchaseKey: expect.any(String),
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
    billing: 'active',
    poweredOn: true,
    agentCount: 0,
    canUndoCancel: false,
    canRestore: false,
    purchasedBy: 'viewer',
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

it('tells a trialing team computers are for paid plans and links to Billing', async () => {
  mocks.offersError = new ThrownResultError([
    {
      code: 'TEAM_ON_TRIAL',
      message:
        'Computers are available on paid plans. Your team is on a trial.',
    },
  ]);
  render(() => <MacroComputers harnesses={[]} onSharingChange={() => {}} />);

  expect(
    await screen.findByText(
      'Computers are available on paid plans. Your team is on a trial.'
    )
  ).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Get a computer' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Go to Billing' }));
  expect(mocks.openSettings).toHaveBeenCalledWith('Billing');
});
