import type { ComputerStatus } from '@service-auth/computers';
import { beforeEach, expect, it, vi } from 'vitest';
import { holdSetupNotices, showComputerSetupNotice } from './setup-notice';

type Options = {
  subtext?: string;
  onDismiss?: () => void;
  actions?: { label: string; onClick: () => void }[];
};

const mocks = vi.hoisted(() => ({
  shown: [] as { kind: string; title: string; options: Options }[],
  dismissed: [] as number[],
  fetchComputers: vi.fn<() => Promise<Partial<ComputerStatus>[]>>(),
  session: 1,
}));

vi.mock('@queries/auth/account-scope', () => ({
  queryAccountSession: () => mocks.session,
}));

vi.mock('@queries/computers/computers', () => ({
  fetchComputers: mocks.fetchComputers,
}));

vi.mock('@core/component/Toast/Toast', () => ({
  toast: {
    success: (title: string, options: Options) =>
      mocks.shown.push({ kind: 'success', title, options }),
    failure: (title: string, options: Options) =>
      mocks.shown.push({ kind: 'failure', title, options }),
    dismiss: (id: number) => {
      mocks.dismissed.push(id);
      mocks.shown[id - 1]?.options.onDismiss?.();
    },
  },
}));

beforeEach(() => {
  mocks.fetchComputers.mockReset();
  mocks.fetchComputers.mockResolvedValue([]);
  mocks.session = 1;
  for (const notice of mocks.shown) notice.options.onDismiss?.();
  mocks.shown = [];
  mocks.dismissed = [];
});

it('says the computer is ready and reopens setup from its action', async () => {
  const open = vi.fn();
  await showComputerSetupNotice(
    {
      computerId: 'computer-1',
      harnessId: 'harness-1',
      computerName: "Maya's Agent Box",
      outcome: { kind: 'ready' },
    },
    open
  );

  expect(mocks.shown).toHaveLength(1);
  const [notice] = mocks.shown;
  expect(notice?.title).toBe(
    'Your computer is ready: connect your AI and finish setup'
  );
  expect(notice?.options.subtext).toBe(
    "Maya's Agent Box is up. Bring your AI, then create an agent on it."
  );
  notice?.options.actions?.[0]?.onClick();
  expect(open).toHaveBeenCalledOnce();
  expect(mocks.dismissed).toEqual([1]);
});

it('says why setup failed and offers Retry setup', async () => {
  await showComputerSetupNotice(
    {
      computerId: 'computer-1',
      harnessId: null,
      computerName: "Maya's Agent Box",
      outcome: { kind: 'failed', failureReason: 'The host ran out of disk.' },
    },
    vi.fn()
  );

  expect(mocks.shown[0]).toMatchObject({
    kind: 'failure',
    title: "Maya's Agent Box could not be set up",
    options: { subtext: 'The host ran out of disk.' },
  });
  expect(mocks.shown[0]?.options.actions?.[0]?.label).toBe('Retry setup');
});

it('shows one notice per computer and outcome while it is up', async () => {
  const ready = {
    computerId: 'computer-1',
    harnessId: 'harness-1',
    computerName: "Maya's Agent Box",
    outcome: { kind: 'ready' as const },
  };
  await showComputerSetupNotice(ready, vi.fn());
  await showComputerSetupNotice(ready, vi.fn());
  expect(mocks.shown).toHaveLength(1);

  mocks.shown[0]?.options.onDismiss?.();
  await showComputerSetupNotice(ready, vi.fn());
  expect(mocks.shown).toHaveLength(2);
});

it('shows no ready notice while the computer is in its buy dialog, and takes one down', async () => {
  const ready = {
    computerId: 'computer-1',
    harnessId: 'harness-1',
    computerName: "Maya's Agent Box",
    outcome: { kind: 'ready' as const },
  };
  await showComputerSetupNotice(ready, vi.fn());
  expect(mocks.shown).toHaveLength(1);

  const release = holdSetupNotices('computer-1');
  expect(mocks.dismissed).toEqual([1]);
  await showComputerSetupNotice(ready, vi.fn());
  expect(mocks.shown).toHaveLength(1);
  // A failure is still said.
  await showComputerSetupNotice(
    { ...ready, outcome: { kind: 'failed', failureReason: 'Disk full.' } },
    vi.fn()
  );
  expect(mocks.shown).toHaveLength(2);

  release();
  await showComputerSetupNotice(ready, vi.fn());
  expect(mocks.shown).toHaveLength(3);
});

it('shows no ready notice for a computer whose setup is complete, read fresh', async () => {
  mocks.fetchComputers.mockResolvedValue([
    { id: 'computer-1', setupCompletedAt: '2026-11-18T18:38:00Z' },
  ]);
  await showComputerSetupNotice(
    {
      computerId: 'computer-1',
      harnessId: 'harness-1',
      computerName: "Maya's Agent Box",
      outcome: { kind: 'ready' },
    },
    vi.fn()
  );
  expect(mocks.fetchComputers).toHaveBeenCalledOnce();
  expect(mocks.shown).toHaveLength(0);
});

it('still shows the ready notice when the list cannot be read', async () => {
  mocks.fetchComputers.mockRejectedValue(new Error('offline'));
  await showComputerSetupNotice(
    {
      computerId: 'computer-1',
      harnessId: 'harness-1',
      computerName: "Maya's Agent Box",
      outcome: { kind: 'ready' },
    },
    vi.fn()
  );
  expect(mocks.shown).toHaveLength(1);
});

it('keeps notices away until the last of two dialogs for a computer closes', async () => {
  const ready = {
    computerId: 'computer-1',
    harnessId: 'harness-1',
    computerName: "Maya's Agent Box",
    outcome: { kind: 'ready' as const },
  };
  const first = holdSetupNotices('computer-1');
  const second = holdSetupNotices('computer-1');
  first();
  first();
  await showComputerSetupNotice(ready, vi.fn());
  expect(mocks.shown).toHaveLength(0);

  second();
  await showComputerSetupNotice(ready, vi.fn());
  expect(mocks.shown).toHaveLength(1);
});

it('shows no ready notice when another login happened while the list was read', async () => {
  mocks.fetchComputers.mockImplementation(async () => {
    mocks.session = 2;
    return [];
  });
  await showComputerSetupNotice(
    {
      computerId: 'computer-1',
      harnessId: 'harness-1',
      computerName: "Maya's Agent Box",
      outcome: { kind: 'ready' },
    },
    vi.fn()
  );
  expect(mocks.shown).toHaveLength(0);
});
