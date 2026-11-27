import { expect, test } from 'bun:test';
import type { PurchaseOffers } from '@macro-inc/sdk/generated/auth';
import {
  type CheckoutAdapter,
  type CheckoutState,
  createCheckout,
  type HireScope,
} from './hire';

const owner: HireScope = {
  status: 'signed-in',
  account: 'sample-viewer',
  session: 'session-1',
  team: 'sample-team',
  teamName: 'Sample team',
  role: 'owner',
  teammatesEnabled: true,
  computersEnabled: true,
};
const offers: PurchaseOffers = {
  renewsAt: '2027-01-01T00:00:00Z',
  sizes: [
    {
      size: 'standard',
      soldOut: false,
      dueToday: 0,
      vcpus: 2,
      memoryGb: 4,
      diskGb: 32,
      quote: {
        size: 'standard',
        interval: 'month',
        currency: 'usd',
        priceId: 'sample',
        amount: 1000,
      },
    },
  ],
};

function fixture() {
  let state: CheckoutState = { status: 'idle' };
  const calls: Array<Parameters<CheckoutAdapter['submit']>[0]> = [];
  const adapter: CheckoutAdapter = {
    readScope: async () => owner,
    readOffers: async () => ({ status: 'quoted', offers }),
    submit: async (intent) => {
      calls.push(intent);
      return { status: 'unknown' };
    },
  };
  let keys = 0;
  const checkout = createCheckout(
    adapter,
    (next) => {
      state = next;
    },
    () => `key-${++keys}`
  );
  return { adapter, checkout, calls, state: () => state };
}

test('no team, member, and disabled rollout never request a quote', async () => {
  for (const [scope, expected] of [
    [{ status: 'signed-out' }, 'signed-out'],
    [{ status: 'no-team' }, 'no-team'],
    [{ ...owner, role: 'member' }, 'denied'],
    [{ ...owner, teammatesEnabled: false }, 'denied'],
    [{ ...owner, computersEnabled: false }, 'denied'],
  ] satisfies Array<[HireScope, CheckoutState['status']]>) {
    const f = fixture();
    f.adapter.readScope = async () => scope;
    f.adapter.readOffers = async () => {
      throw new Error('unauthorized quote');
    };
    await f.checkout.load();
    expect(f.state()).toEqual({ status: expected });
    expect(f.calls).toEqual([]);
  }
});

test('a changed quote requires a new confirmation; missing sizes never send', async () => {
  const f = fixture();
  await f.checkout.load();
  f.adapter.readOffers = async () => ({
    status: 'quoted',
    offers: {
      ...offers,
      sizes: offers.sizes.map((size) => ({ ...size, dueToday: 250 })),
    },
  });
  await f.checkout.confirm({ name: 'Sample' }, 'xl');
  await f.checkout.confirm({ name: 'Sample' }, 'standard');
  expect(f.state()).toMatchObject({
    status: 'review',
    notice: 'quote-changed',
  });
  expect(f.calls).toEqual([]);
  await f.checkout.confirm({ name: 'Sample' }, 'standard');
  expect(f.calls[0]?.request.purchaseKey).toBe('key-1');
});

test('concurrent submits and ambiguous replay keep one immutable intent', async () => {
  const f = fixture();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  f.adapter.submit = async (intent) => {
    f.calls.push(intent);
    entered.resolve();
    await release.promise;
    return { status: 'in-progress' };
  };
  await f.checkout.load();
  const first = f.checkout.confirm({ name: '  Sample  ' }, 'standard');
  await entered.promise;
  await f.checkout.confirm({ name: 'Changed' }, 'standard');
  expect(f.calls).toHaveLength(1);
  release.resolve();
  await first;
  await f.checkout.confirm({ name: 'Changed' }, 'standard');
  expect(f.calls).toHaveLength(1);
  await f.checkout.retry();
  expect(f.calls).toHaveLength(2);
  expect(f.calls[1]).toBe(f.calls[0]);
  expect(f.calls[1]?.request).toMatchObject({
    name: 'Sample',
    purchaseKey: 'key-1',
  });
  expect(f.state()).toEqual({ status: 'unknown' });
});

test('an account, team, or role change blocks the send or replay', async () => {
  const f = fixture();
  await f.checkout.load();
  f.adapter.readScope = async () => ({ ...owner, team: 'other-team' });
  await f.checkout.confirm({ name: 'Sample' }, 'standard');
  expect(f.calls).toEqual([]);
  expect(f.state()).toEqual({ status: 'scope-changed' });

  f.adapter.readScope = async () => owner;
  await f.checkout.load();
  await f.checkout.confirm({ name: 'Sample' }, 'standard');
  f.adapter.readScope = async () => ({ ...owner, role: 'admin' });
  await f.checkout.retry();
  expect(f.calls).toHaveLength(1);
  expect(f.state()).toEqual({ status: 'scope-changed' });
});

test('a late accepted response after account change cannot publish a receipt', async () => {
  const f = fixture();
  await f.checkout.load();
  f.adapter.submit = async () => {
    f.adapter.readScope = async () => ({ ...owner, account: 'other-account' });
    return {
      status: 'accepted',
      agent: {
        teamId: owner.team,
        userId: 'sample-agent',
        computerId: 'sample-computer',
        name: 'Sample',
        status: 'provisioning',
        jobDescription: '',
        personality: '',
        createdAt: '2026-11-26',
      },
    };
  };
  await f.checkout.confirm({ name: 'Sample' }, 'standard');
  expect(f.state()).toEqual({ status: 'scope-changed' });
});

test('a transport loss is ambiguous even if the replay reports a refusal', async () => {
  const f = fixture();
  await f.checkout.load();
  f.adapter.submit = async (intent) => {
    f.calls.push(intent);
    if (f.calls.length === 1) throw new Error('connection ended');
    return { status: 'declined' };
  };
  await f.checkout.confirm({ name: 'Sample' }, 'standard');
  await f.checkout.retry();
  expect(f.calls[1]).toBe(f.calls[0]);
  expect(f.state()).toEqual({ status: 'unknown' });
});

test('a late quote does not publish in a new team scope', async () => {
  const f = fixture();
  f.adapter.readOffers = async () => {
    f.adapter.readScope = async () => ({ ...owner, team: 'other-team' });
    return { status: 'quoted', offers };
  };
  await f.checkout.load();
  expect(f.state()).toEqual({ status: 'scope-changed' });
  await f.checkout.confirm({ name: 'Sample' }, 'standard');
  expect(f.calls).toEqual([]);
});
