import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { beforeEach, expect, it, vi } from 'vitest';
import type { SharingSource } from '../../access-requests/context/contracts';
import { fakeSharingSource } from '../../access-requests/tests/source';
import { RuntimeAccessAction } from './RuntimeAccessAction';

let source: SharingSource;
vi.mock('@app/features/access-requests/queries/source', () => ({
  createSharingSource: () => source,
}));

beforeEach(() => {
  source = fakeSharingSource({
    accessLevel: null,
    supportedLevels: ['view'],
  }).source;
});

it('requests only the server-supported view level on an agent computer', async () => {
  const submit = vi.spyOn(source, 'submit');
  render(() => (
    <RuntimeAccessAction harnessId="00000000-0000-0000-0000-000000000001" />
  ));
  fireEvent.click(
    screen.getByRole('button', { name: 'Requested access level' })
  );
  expect(screen.queryByRole('menuitem', { name: 'Edit' })).toBeNull();
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: 'Request access' }));
  await waitFor(() => expect(submit).toHaveBeenCalledWith('view', undefined));
});

it('offers edit requests for an ordinary reader only when supported by the server', async () => {
  source = fakeSharingSource({
    accessLevel: 'view',
    supportedLevels: ['view', 'edit'],
  }).source;
  render(() => (
    <RuntimeAccessAction
      harnessId="00000000-0000-0000-0000-000000000001"
      controlOnly
    />
  ));
  expect(
    screen.getByText(
      'You can watch this computer. Request edit access to take control.'
    )
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Request access' }));
  await waitFor(() =>
    expect(source.submit).toHaveBeenCalledWith('edit', undefined)
  );
});
it('offers no control hint or action when the server caps requests at View', () => {
  render(() => (
    <RuntimeAccessAction
      harnessId="00000000-0000-0000-0000-000000000001"
      controlOnly
    />
  ));
  expect(screen.queryByText(/Request edit access to take control/)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Request access' })).toBeNull();
});
