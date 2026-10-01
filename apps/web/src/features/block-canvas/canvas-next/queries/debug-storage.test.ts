import {
  createGraphicsEditor,
  drawableIds,
  setShapeLabelCommand,
} from '@macro-inc/graphics';
import { afterEach, expect, it, vi } from 'vitest';
import { createCanvasNextScene } from '../core/seed-scene';
import { plainRichText } from '../core/text-codec';
import { attachDebugStorage, CANVAS_DEBUG_STORAGE_KEY } from './debug-storage';

afterEach(() => vi.useRealTimers());
it.each([plainRichText('Saved label'), '{broken'])(
  'validates host text before restoring a saved scene (%s)',
  (content) => {
    const source = createGraphicsEditor(createCanvasNextScene());
    source.execute(setShapeLabelCommand, {
      id: 'welcome-rectangle',
      label: { content, fontSize: 24, fontFamily: 'sans', height: 32 },
    });
    const raw = JSON.stringify({
      version: 1,
      document: source.document,
      camera: source.getCamera(),
    });
    const editor = createGraphicsEditor();
    const before = editor.document;
    const onError = vi.fn();
    const persistence = attachDebugStorage(
      editor,
      () => ({ getItem: () => raw, setItem: vi.fn() }),
      onError
    );
    expect(persistence.restored).toBe(content !== '{broken');
    if (content === '{broken') {
      expect(editor.document).toBe(before);
      expect(onError).toHaveBeenCalledOnce();
    } else {
      expect(editor.document).toEqual(source.document);
      expect(onError).not.toHaveBeenCalled();
    }
    persistence.dispose();
    editor.dispose();
    source.dispose();
  }
);
it('restores document edits and the exact camera after flushing a pending save', () => {
  vi.useFakeTimers();
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
  const onError = vi.fn();
  const editor = createGraphicsEditor(createCanvasNextScene());
  const persistence = attachDebugStorage(editor, () => storage, onError);
  expect(persistence.restored).toBe(false);
  editor.select('welcome-small');
  editor.deleteSelection();
  editor.zoomAt({ x: 0, y: 0 }, 2);
  editor.panBy({ x: 123, y: -45 });
  persistence.dispose();
  const next = createGraphicsEditor();
  const restored = attachDebugStorage(next, () => storage, onError);
  expect(restored.restored).toBe(true);
  expect(drawableIds(next.document)).toHaveLength(2);
  expect(next.document).toEqual(editor.document);
  expect(next.getCamera()).toEqual(editor.getCamera());
  expect(onError).not.toHaveBeenCalled();
  restored.dispose();
  editor.dispose();
  next.dispose();
});
it('debounces writes and persists Reset demo', () => {
  vi.useFakeTimers();
  const storage = { getItem: () => null, setItem: vi.fn() };
  const editor = createGraphicsEditor();
  const persistence = attachDebugStorage(editor, () => storage, vi.fn());
  storage.setItem.mockClear();
  for (let i = 0; i < 10; i++) editor.panBy({ x: 1, y: 0 });
  expect(storage.setItem).not.toHaveBeenCalled();
  editor.resetDocument(createCanvasNextScene());
  vi.advanceTimersByTime(200);
  expect(storage.setItem).toHaveBeenCalledTimes(1);
  expect(storage.setItem.mock.calls[0]![0]).toBe(CANVAS_DEBUG_STORAGE_KEY);
  expect(JSON.parse(storage.setItem.mock.calls[0]![1]).document).toEqual(
    editor.document
  );
  persistence.dispose();
  editor.dispose();
});
it('keeps the canvas usable when snapshots are invalid or storage is blocked', () => {
  const editor = createGraphicsEditor(createCanvasNextScene());
  const original = editor.document;
  const onError = vi.fn();
  const invalid = attachDebugStorage(
    editor,
    () => ({ getItem: () => '{broken', setItem: vi.fn() }),
    onError
  );
  expect(invalid.restored).toBe(false);
  expect(editor.document).toBe(original);
  invalid.dispose();
  const blocked = attachDebugStorage(
    editor,
    () => {
      throw new Error('Storage unavailable');
    },
    onError
  );
  expect(blocked.restored).toBe(false);
  expect(onError).toHaveBeenCalled();
  blocked.dispose();
  editor.dispose();
});
