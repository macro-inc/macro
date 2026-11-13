/**
 * @vitest-environment jsdom
 */

import type { Harness as RegisteredHarness } from '@service-storage/client';
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RuntimeOptions } from './runtime-options';

const mocks = vi.hoisted(() => ({
  patch: vi.fn(),
  confirm: vi.fn(async () => true),
}));

vi.mock('@ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ui')>()),
  confirmDialog: mocks.confirm,
}));

vi.mock('@queries/harnesses/harnesses', () => ({
  usePatchHarnessMutation: () => ({
    mutateAsync: mocks.patch,
    isPending: false,
  }),
}));

const HARNESS: RegisteredHarness = {
  id: '3f1c9d2e-8a4b-4c5d-9e6f-1a2b3c4d5e6f',
  allow_permission_bypass: false,
  kind: 'macrod',
  name: 'Dev box',
  owner: { type: 'user', user_id: 'macro|user@example.com' },
  access: 'owner',
  shared_team_ids: [],
  created_by: 'macro|user@example.com',
  created_at: '2026-08-27T12:00:00Z',
  updated_at: '2026-08-27T12:00:00Z',
  connected: true,
  last_connected_at: '2026-08-27T12:34:00Z',
};

async function openOptions() {
  fireEvent.keyDown(screen.getByRole('button', { name: 'Options' }), {
    key: 'ArrowDown',
  });
  return screen.findByRole('menuitemcheckbox', {
    name: "Don't ask before acting",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.patch.mockResolvedValue(undefined);
});

describe('RuntimeOptions', () => {
  it("turns on Don't ask before acting after confirming", async () => {
    render(() => <RuntimeOptions harness={HARNESS} />);

    const option = await openOptions();
    expect(option.getAttribute('aria-checked')).toBe('false');
    fireEvent.keyDown(option, { key: 'Enter' });

    await waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith({
        harnessId: HARNESS.id,
        allowPermissionBypass: true,
      })
    );
    expect(mocks.confirm).toHaveBeenCalledOnce();
  });

  it('does not turn it on when the confirmation is cancelled', async () => {
    mocks.confirm.mockResolvedValueOnce(false);
    render(() => <RuntimeOptions harness={HARNESS} />);

    fireEvent.keyDown(await openOptions(), { key: 'Enter' });

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce());
    expect(mocks.patch).not.toHaveBeenCalled();
  });

  it('turns it off without confirming', async () => {
    render(() => (
      <RuntimeOptions harness={{ ...HARNESS, allow_permission_bypass: true }} />
    ));

    const option = await openOptions();
    expect(option.getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(option, { key: 'Enter' });

    await waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith({
        harnessId: HARNESS.id,
        allowPermissionBypass: false,
      })
    );
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('shows the current value read-only to anyone but the owner', async () => {
    render(() => (
      <RuntimeOptions
        harness={{ ...HARNESS, access: 'user', allow_permission_bypass: true }}
      />
    ));

    const option = await openOptions();
    expect(option.getAttribute('aria-checked')).toBe('true');
    expect(option.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Only the owner can change this.')).toBeTruthy();
    fireEvent.keyDown(option, { key: 'Enter' });
    expect(mocks.patch).not.toHaveBeenCalled();
  });
});
