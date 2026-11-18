import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { ok } from 'neverthrow';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ShareMenu } from '../components/share-menu';
import type { PasswordGrant, PasswordRecipient } from '../core/types';

beforeEach(() => vi.stubGlobal('scrollTo', vi.fn()));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const RECIPIENTS: PasswordRecipient[] = [
  { kind: 'user', id: 'human-1', name: 'Avery Lee' },
  { kind: 'user', id: 'human-2', name: 'Jordan Reed' },
  { kind: 'team', id: 'team-1', name: 'Product team' },
];

it('shares with a searched human name while preserving existing grants', async () => {
  const share = vi.fn(async () => true);
  const existing: PasswordGrant = {
    kind: 'team',
    id: 'team-1',
    permission: 'view',
  };
  render(() => (
    <ShareMenu
      recipients={RECIPIENTS}
      recipientsLoading={false}
      recipientsError={false}
      loadGrants={async () => ok([existing])}
      onShare={share}
    />
  ));
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Share' }));
  const search = await screen.findByRole('searchbox', {
    name: 'Search people and teams',
  });
  await user.type(search, 'avery');
  expect(screen.queryByRole('button', { name: /Jordan Reed/ })).toBeNull();
  await user.click(screen.getByRole('button', { name: /Avery Lee/ }));
  await user.click(screen.getByRole('button', { name: 'Can edit' }));
  const save = screen.getAllByRole('button', { name: 'Share' }).at(-1);
  if (!save) throw new Error('Share action missing');
  await user.click(save);
  expect(share).toHaveBeenCalledExactlyOnceWith([
    existing,
    { kind: 'user', id: 'human-1', permission: 'edit' },
  ]);
  expect(screen.queryByText('human-1')).toBeNull();
  expect(screen.queryByText('team-1')).toBeNull();
});

it('rejects a recipient removed from the team directory before submission', async () => {
  const share = vi.fn(async () => true);
  const [recipients, setRecipients] = createSignal(RECIPIENTS);
  render(() => (
    <ShareMenu
      recipients={recipients()}
      recipientsLoading={false}
      recipientsError={false}
      loadGrants={async () => ok([])}
      onShare={share}
    />
  ));
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Share' }));
  await user.click(await screen.findByRole('button', { name: /Avery Lee/ }));
  setRecipients(RECIPIENTS.filter((recipient) => recipient.id !== 'human-1'));
  const save = screen.getAllByRole('button', { name: 'Share' }).at(-1);
  if (!save) throw new Error('Share action missing');
  expect(save.hasAttribute('disabled')).toBe(true);
  const form = save.closest('form');
  if (!form) throw new Error('Share form missing');
  fireEvent.submit(form);
  expect(share).not.toHaveBeenCalled();
});
