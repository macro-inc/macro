import { render, waitFor } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MacrodPairingApprover } from './MacrodPairingApprover';
import type { MacrodStatus } from './macrod';

const daemon = vi.hoisted(() => ({
  snapshot: undefined as MacrodStatus | undefined,
  emit: undefined as ((status: MacrodStatus) => void) | undefined,
  approve: vi.fn((_code: string) => {}),
}));

vi.mock('./macrod', () => ({
  macrodStatus: async () => daemon.snapshot,
  onMacrodStatus: async (callback: (status: MacrodStatus) => void) => {
    daemon.emit = callback;
    return () => {};
  },
}));
vi.mock('@queries/harnesses/harnesses', () => ({
  useApproveOwnHarnessPairingMutation: () => ({ mutate: daemon.approve }),
}));

function status(
  phase: MacrodStatus['phase'],
  pairingCode: string | null = null
): MacrodStatus {
  return {
    phase,
    agentId: null,
    agentName: null,
    workspace: null,
    pairingCode,
    pairingExpiresAt: null,
    harnessId: null,
    lastError: null,
  };
}

describe('MacrodPairingApprover', () => {
  beforeEach(() => {
    daemon.snapshot = status('stopped');
    daemon.emit = undefined;
    daemon.approve.mockClear();
  });

  it('approves a pairing that opened before it mounted', async () => {
    daemon.snapshot = status('pairing', 'ABCD-1234');
    render(() => <MacrodPairingApprover />);
    await waitFor(() =>
      expect(daemon.approve).toHaveBeenCalledWith('ABCD-1234')
    );
  });

  it('approves each new code from a re-pair once', async () => {
    render(() => <MacrodPairingApprover />);
    await waitFor(() => expect(daemon.emit).toBeDefined());

    daemon.emit?.(status('pairing', 'AAAA-1111'));
    daemon.emit?.(status('pairing', 'AAAA-1111'));
    daemon.emit?.(status('running'));
    daemon.emit?.(status('pairing', 'BBBB-2222'));

    expect(daemon.approve.mock.calls).toEqual([['AAAA-1111'], ['BBBB-2222']]);
  });
});
