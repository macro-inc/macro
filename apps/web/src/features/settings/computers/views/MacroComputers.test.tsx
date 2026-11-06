/**
 * @vitest-environment jsdom
 */

import { ThrownResultError } from '@core/util/result';
import type { ComputerStatus, SizeOffer } from '@service-auth/computers';
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
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
      alwaysOnSoldOut: false,
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
      alwaysOnSoldOut: false,
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
      alwaysOnSoldOut: false,
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

  render(() => <MacroComputers harnesses={[]} />);

  const continueButton = screen.getByRole('button', { name: 'Continue' });
  expect(continueButton).toHaveProperty('disabled', true);
  expect(screen.getByRole('radio', { name: 'XL' })).toHaveProperty(
    'disabled',
    true
  );

  fireEvent.click(screen.getByRole('button', { name: 'Notify me' }));
  await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith('xl'));

  fireEvent.click(screen.getByRole('radio', { name: 'Large' }));
  expect(continueButton).toHaveProperty('disabled', false);
  fireEvent.click(continueButton);

  await screen.findByText('Buy a Large Macro computer?');
  const buyButton = screen.getByRole('button', { name: 'Buy for $80/month' });

  fireEvent.click(buyButton);
  expect((await screen.findByRole('alert')).textContent).toBe(
    'That size just sold out.'
  );
  expect(mocks.purchase).toHaveBeenNthCalledWith(1, {
    size: 'large',
    name: undefined,
  });

  fireEvent.input(screen.getByLabelText('Name (optional)'), {
    target: { value: '  Build machine  ' },
  });
  fireEvent.click(buyButton);
  await waitFor(() =>
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      'Computer purchased. Setting it up now.'
    )
  );
  expect(mocks.purchase).toHaveBeenNthCalledWith(2, {
    size: 'large',
    name: 'Build machine',
  });
  await waitFor(() =>
    expect(screen.queryByText('Buy a Large Macro computer?')).toBeNull()
  );
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

  render(() => <MacroComputers harnesses={[]} />);

  const remove = screen.getByRole('button', { name: 'Remove' });
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
  render(() => <MacroComputers harnesses={[]} />);
  expect(screen.getByText('Build machine')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Cancel at period end' })
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Release now' }));
  expect(await screen.findByLabelText(/Type/)).toBeTruthy();
});
