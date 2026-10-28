import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { ok } from 'neverthrow';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { DocumentNotesSource } from '../context/notes-source';
import type { DocumentNoteLink } from '../core/types';
import { DocumentNotesView } from './document-notes';

afterEach(cleanup);

it('keeps Unlink mounted and usable while team access saves, without allowing concurrent writes', async () => {
  const link = {
    eventId: 'event',
    occurrenceKey: 'single',
    eventTitle: 'Sync',
  };
  const team = { id: 'team', name: 'Macro' };
  const [links, setLinks] = createSignal<DocumentNoteLink[]>([link]);
  const saved = Promise.withResolvers<void>();
  const source: DocumentNotesSource = {
    links: () => ({ data: links(), pending: false }),
    team: () => ({ data: team, pending: false }),
    retry: async () => {},
    setTeam: async () => {
      await saved.promise;
      setLinks([{ ...link, team }]);
      return ok(undefined);
    },
    unlink: vi.fn(async () => ok(undefined)),
  };
  render(() => <DocumentNotesView source={source} />);
  const unlink = screen.getByRole('button', { name: 'Unlink' });
  const checkbox = screen.getByRole('checkbox');
  await fireEvent.click(checkbox);
  expect(unlink.hasAttribute('disabled')).toBe(false);
  await fireEvent.click(unlink);
  const confirm = screen.getByRole('button', { name: 'Unlink meeting' });
  expect(confirm.hasAttribute('disabled')).toBe(true);
  await fireEvent.click(confirm);
  expect(source.unlink).not.toHaveBeenCalled();

  saved.resolve();
  await vi.waitFor(() => expect(confirm.hasAttribute('disabled')).toBe(false));
  expect(screen.getByRole('button', { name: 'Unlink' })).toBe(unlink);
  expect(screen.getByRole('checkbox')).toBe(checkbox);
  await fireEvent.click(confirm);
  expect(source.unlink).toHaveBeenCalledOnce();
});
