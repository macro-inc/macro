import { err, ok, type Result } from 'neverthrow';
import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NoteCreateFailure, NoteDocument } from '../core/types';
import { createFakeNotesSource } from '../tests/fake-source';
import { createMeetingNoteAction } from './create-meeting-note';

let dispose = () => {};
afterEach(() => dispose());

function fixture(fail = false) {
  return createRoot((cleanup) => {
    dispose = cleanup;
    const fake = createFakeNotesSource({ fail });
    const create = vi.spyOn(fake.source, 'create');
    const link = vi.spyOn(fake.source, 'link');
    const onOpen = vi.fn();
    const action = createMeetingNoteAction({
      source: fake.source,
      title: () => 'Weekly product sync',
      onOpen,
    });
    return { ...fake, create, link, onOpen, action };
  });
}

describe('creating meeting notes', () => {
  it('waits for linking before opening and suppresses duplicate clicks', async () => {
    const { action, create, onOpen } = fixture();
    let finish = (_result: Result<NoteDocument, NoteCreateFailure>) => {};
    create.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const creating = action.run();
    await action.run();
    expect(create).toHaveBeenCalledExactlyOnceWith('Weekly product sync notes');
    expect(action.pending()).toBe(true);
    expect(onOpen).not.toHaveBeenCalled();
    const document = { documentId: 'saved', name: 'Weekly product sync notes' };
    finish(ok(document));
    await creating;
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(document);
    expect(action.pending()).toBe(false);
  });

  it('retries linking the saved document without creating another one', async () => {
    const { action, create, link, notes, onOpen } = fixture(true);
    await action.run();
    expect(action.saved()?.documentId).toBe('created-1');
    expect(action.error()).toBeDefined();
    expect(action.pending()).toBe(false);
    expect(notes()).toEqual([]);
    expect(onOpen).not.toHaveBeenCalled();
    await action.run();
    expect(create).toHaveBeenCalledOnce();
    expect(link).toHaveBeenNthCalledWith(1, 'created-1');
    expect(link).toHaveBeenNthCalledWith(2, 'created-1');
    expect(notes()).toEqual([
      {
        documentId: 'created-1',
        name: 'Weekly product sync notes',
        canManage: true,
      },
    ]);
    expect(action.saved()).toBeUndefined();
    expect(action.error()).toBeUndefined();
    expect(onOpen).toHaveBeenCalledExactlyOnceWith({
      documentId: 'created-1',
      name: 'Weekly product sync notes',
    });
  });

  it('can open the saved note after linking fails', async () => {
    const { action, create, onOpen } = fixture(true);
    await action.run();
    action.openSaved();
    expect(create).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledExactlyOnceWith({
      documentId: 'created-1',
      name: 'Weekly product sync notes',
    });
  });

  it('allows retry after document creation fails without navigating', async () => {
    const { action, create, link, onOpen } = fixture();
    create.mockResolvedValueOnce(
      err({ kind: 'create_failed', message: 'Offline' })
    );
    await action.run();
    expect(action.pending()).toBe(false);
    expect(action.saved()).toBeUndefined();
    expect(link).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
    await action.run();
    expect(create).toHaveBeenCalledTimes(2);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('does not navigate after the meeting or account changes', async () => {
    const { action, create, onOpen } = fixture();
    let finish = (_result: Result<NoteDocument, NoteCreateFailure>) => {};
    create.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const creating = action.run();
    dispose();
    finish(ok({ documentId: 'saved', name: 'Weekly product sync notes' }));
    await creating;
    expect(onOpen).not.toHaveBeenCalled();
    await action.run();
    expect(create).toHaveBeenCalledOnce();
  });
});
