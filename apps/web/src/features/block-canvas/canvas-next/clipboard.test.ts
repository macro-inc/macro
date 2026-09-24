import { createGraphicsEditor, drawableIds } from '@macro-inc/graphics';
import { afterEach, expect, it, vi } from 'vitest';
import { createCanvasClipboard } from './clipboard';
import { createCanvasNextScene } from './core/seed-scene';

const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.splice(0).forEach((fn) => fn());
  vi.unstubAllGlobals();
});

function setup() {
  const editor = createGraphicsEditor(createCanvasNextScene());
  const host = document.createElement('div');
  const input = document.createElement('input');
  host.append(input);
  const notify = vi.fn();
  const clipboard = createCanvasClipboard(editor, notify);
  cleanup.push(clipboard.attach(host), editor.dispose);
  const data = new Map<string, string>();
  const event = (type: string, target: HTMLElement = host) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: {
        setData: (key: string, value: string) => data.set(key, value),
        getData: (key: string) => data.get(key) ?? '',
      },
    });
    target.dispatchEvent(event);
    return event;
  };
  return { editor, input, data, event, clipboard, notify };
}

it('copies/cuts/pastes native events, offsets repeated pastes, and undoes the whole fragment', () => {
  const { editor, data, event } = setup();
  editor.select('welcome-rectangle');
  expect(event('copy').defaultPrevented).toBe(true);
  expect(data.get('application/x-macro-graphics')).toBe(data.get('text/plain'));
  expect(event('paste').defaultPrevented).toBe(true);
  const first = editor.document.items[editor.getSession().selectedIds[0]!]!;
  event('paste');
  const second = editor.document.items[editor.getSession().selectedIds[0]!]!;
  expect(first.type !== 'surface' && first.transform[4]).toBe(124);
  expect(second.type !== 'surface' && second.transform[4]).toBe(148);
  expect(drawableIds(editor.document)).toHaveLength(5);
  event('cut');
  expect(drawableIds(editor.document)).toHaveLength(4);
  editor.undo();
  expect(drawableIds(editor.document)).toHaveLength(5);
});

it('leaves clipboard editing in inputs alone and rejects unrelated external clipboard data', () => {
  const { editor, input, data, event } = setup();
  editor.select('welcome-rectangle');
  expect(event('cut', input).defaultPrevented).toBe(false);
  data.set('text/plain', 'ordinary text');
  expect(event('paste').defaultPrevented).toBe(false);
  expect(drawableIds(editor.document)).toHaveLength(3);
  expect(editor.getSession().canUndo).toBe(false);
});

it('never deletes on failed clipboard write or deletes a newer selection after an async cut', async () => {
  const { editor, clipboard, notify } = setup();
  editor.select('welcome-rectangle');
  vi.stubGlobal('navigator', {
    clipboard: { writeText: () => Promise.reject(new Error('denied')) },
  });
  await clipboard.cut();
  expect(drawableIds(editor.document)).toHaveLength(3);
  expect(notify).toHaveBeenCalledWith(
    expect.stringContaining('permission denied')
  );
  let finish!: () => void;
  vi.stubGlobal('navigator', {
    clipboard: {
      writeText: () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    },
  });
  const cut = clipboard.cut();
  editor.select('welcome-ellipse');
  finish();
  await cut;
  expect(drawableIds(editor.document)).toHaveLength(3);
});
