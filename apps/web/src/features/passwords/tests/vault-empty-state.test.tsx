import { cleanup, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { VaultEmptyState } from '../components/vault-empty-state';

afterEach(cleanup);

it('offers creating and importing when the vault has no passwords', async () => {
  const onCreate = vi.fn();
  const onImport = vi.fn();
  render(() => (
    <VaultEmptyState reason="vault" onCreate={onCreate} onImport={onImport} />
  ));
  expect(screen.getByText('No passwords yet')).toBeTruthy();
  const user = userEvent.setup();

  await user.click(screen.getByRole('button', { name: 'Import' }));
  expect(onImport).toHaveBeenCalledOnce();

  await user.click(screen.getByRole('button', { name: 'New login' }));
  expect(onCreate).toHaveBeenCalledExactlyOnceWith('login');
});

it('keeps a filtered, searched or folder view to its message alone', () => {
  for (const [reason, message] of [
    ['search', 'No matching items'],
    ['folder', 'This folder is empty'],
    ['filter', 'No passwords here yet'],
  ] as const) {
    render(() => (
      <VaultEmptyState reason={reason} onCreate={vi.fn()} onImport={vi.fn()} />
    ));
    expect(screen.getByText(message)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    cleanup();
  }
});
