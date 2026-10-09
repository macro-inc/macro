import {
  createGraphicsEditor,
  setShapeLabelCommand,
} from '@macro-inc/graphics';
import { afterEach, expect, it, vi } from 'vitest';
import type { CanvasFile } from '../core/document-format';
import { createCanvasNextScene } from '../core/seed-scene';
import { plainRichText } from '../core/text-codec';
import { createDocumentPersistence } from './create-document-persistence';

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((f) => f());
  vi.useRealTimers();
});
function setup(
  save = vi.fn(async (_file: CanvasFile) => new Blob()),
  canEdit = () => true
) {
  vi.useFakeTimers();
  const initial: CanvasFile = { version: 2, document: createCanvasNextScene() };
  const editor = createGraphicsEditor(initial.document);
  const persistence = createDocumentPersistence(editor, initial, {
    save,
    canEdit,
  });
  cleanups.push(() => {
    persistence.dispose();
    editor.dispose();
  });
  const edit = (text: string) =>
    editor.execute(setShapeLabelCommand, {
      id: 'welcome-rectangle',
      label: {
        content: plainRichText(text),
        fontSize: 24,
        fontFamily: 'sans',
        height: 32,
      },
    });
  return { editor, persistence, edit, save };
}

it('does not save on load, view changes, or in read-only mode', async () => {
  const { editor, persistence, edit, save } = setup(undefined, () => false);
  editor.panBy({ x: 10, y: 20 });
  await vi.advanceTimersByTimeAsync(1000);
  await persistence.flush();
  expect(save).not.toHaveBeenCalled();
  edit('Blocked');
  await vi.advanceTimersByTimeAsync(1000);
  await persistence.flush();
  expect(save).not.toHaveBeenCalled();
});

it('debounces edits and round-trips a versioned snapshot', async () => {
  const { editor, persistence, edit, save } = setup();
  await persistence.flush();
  expect(save).not.toHaveBeenCalled();
  edit('One');
  edit('Two');
  await vi.advanceTimersByTimeAsync(500);
  expect(save).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0]?.[0]).toEqual({
    version: 2,
    document: editor.document,
  });
  expect(persistence.dirty()).toBe(false);
});

it('serializes saves and drains edits made while a request is pending', async () => {
  let finish!: (blob: Blob) => void;
  const save = vi.fn(
    (_file: CanvasFile) =>
      new Promise<Blob>((resolve) => {
        finish = resolve;
      })
  );
  const { editor, persistence, edit } = setup(save);
  edit('First');
  const flushing = persistence.flush();
  edit('Second');
  await vi.advanceTimersByTimeAsync(500);
  expect(save).toHaveBeenCalledTimes(1);
  finish(new Blob());
  await Promise.resolve();
  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[1]?.[0].document).toBe(editor.document);
  finish(new Blob());
  await flushing;
  expect(persistence.status()).toBe('saved');
});

it('keeps failed edits dirty and retries the latest snapshot', async () => {
  const save = vi
    .fn(async (_file: CanvasFile) => new Blob())
    .mockRejectedValueOnce(new Error('offline'));
  const { editor, persistence, edit } = setup(save);
  edit('Unsaved');
  await persistence.flush();
  expect(persistence.status()).toBe('error');
  expect(persistence.dirty()).toBe(true);
  edit('Newest');
  await persistence.flush();
  expect(save.mock.calls[1]?.[0].document).toBe(editor.document);
  expect(persistence.dirty()).toBe(false);
});

it('rechecks permissions after a queued edit', async () => {
  let writable = true;
  const { persistence, edit, save } = setup(undefined, () => writable);
  edit('Change');
  writable = false;
  await vi.advanceTimersByTimeAsync(500);
  expect(save).not.toHaveBeenCalled();
  expect(persistence.dirty()).toBe(true);
});
