import { ok } from 'neverthrow';
import { createRoot, createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';
import type { NotesSource } from '../context/notes-source';
import type { MeetingNote } from '../core/types';
import { createNotesController } from './notes-controller';

it('does not overwrite an existing team grant when its link arrives after selection', async () => {
  const document = { documentId: 'note', name: 'Notes' };
  const [notes, setNotes] = createSignal<MeetingNote[]>();
  const source: NotesSource = {
    notes: () => ({ pending: !notes(), data: notes() }),
    picker: () => () => ({
      pending: false,
      data: { documents: [document], teams: [] },
    }),
    create: async () => ok(document),
    retry: async () => {},
    link: vi.fn(async () => ok(undefined)),
    unlink: async () => ok(undefined),
  };
  const { controller, dispose } = createRoot((dispose) => ({
    controller: createNotesController(source, () => {}),
    dispose,
  }));
  try {
    controller.openLink();
    controller.setSelected(document);
    await controller.save();
    expect(source.link).not.toHaveBeenCalled();
    setNotes([
      { ...document, canManage: true, team: { id: 'team', name: 'Macro' } },
    ]);
    await controller.save();
    expect(source.link).not.toHaveBeenCalled();
    expect(controller.dialog()?.kind).toBe('link');
    controller.setSelected({ documentId: 'new-note', name: 'Another note' });
    await controller.save();
    expect(source.link).toHaveBeenCalledExactlyOnceWith('new-note', undefined);
    expect(controller.dialog()).toBeUndefined();
  } finally {
    dispose();
  }
});
