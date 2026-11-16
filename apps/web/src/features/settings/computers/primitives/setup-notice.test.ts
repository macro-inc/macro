import { beforeEach, expect, it, vi } from 'vitest';
import { showComputerSetupNotice } from './setup-notice';

type Options = {
  subtext?: string;
  onDismiss?: () => void;
  actions?: { label: string; onClick: () => void }[];
};

const mocks = vi.hoisted(() => ({
  shown: [] as { kind: string; title: string; options: Options }[],
  dismissed: [] as number[],
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
  for (const notice of mocks.shown) notice.options.onDismiss?.();
  mocks.shown = [];
  mocks.dismissed = [];
});

it('says the computer is ready and reopens setup from its action', () => {
  const open = vi.fn();
  showComputerSetupNotice(
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

it('says why setup failed and offers Retry setup', () => {
  showComputerSetupNotice(
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

it('shows one notice per computer and outcome while it is up', () => {
  const ready = {
    computerId: 'computer-1',
    harnessId: 'harness-1',
    computerName: "Maya's Agent Box",
    outcome: { kind: 'ready' as const },
  };
  showComputerSetupNotice(ready, vi.fn());
  showComputerSetupNotice(ready, vi.fn());
  expect(mocks.shown).toHaveLength(1);

  mocks.shown[0]?.options.onDismiss?.();
  showComputerSetupNotice(ready, vi.fn());
  expect(mocks.shown).toHaveLength(2);
});
