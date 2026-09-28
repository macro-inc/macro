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
  return { editor, input, host, data, event, clipboard, notify };
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

it('leaves native rich-text paste and already-handled clipboard events to the text editor', () => {
  const editor = createGraphicsEditor();
  cleanup.push(editor.dispose);
  const host = document.createElement('div'),
    editable = document.createElement('div');
  editable.setAttribute('contenteditable', '');
  host.append(editable);
  const pasteText = vi.fn(),
    clipboard = createCanvasClipboard(editor, () => {}, pasteText);
  cleanup.push(clipboard.attach(host));
  function paste(target: HTMLElement, handled = false) {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: { getData: () => 'Rich text' },
    });
    if (handled) event.preventDefault();
    target.dispatchEvent(event);
  }
  paste(editable);
  paste(host, true);
  expect(pasteText).not.toHaveBeenCalled();
  paste(host);
  expect(pasteText).toHaveBeenCalledOnce();
});

it('routes pasted media to the host and preserves native paste inside text editing', async () => {
  const editor = createGraphicsEditor();
  cleanup.push(editor.dispose);
  const host = document.createElement('div');
  const editable = document.createElement('div');
  editable.setAttribute('contenteditable', 'true');
  host.append(editable);
  const pasteText = vi.fn(),
    pasteFiles = vi.fn();
  const clipboard = createCanvasClipboard(
    editor,
    vi.fn(),
    pasteText,
    pasteFiles
  );
  cleanup.push(clipboard.attach(host));
  const file = new File(['image'], 'picture.png', { type: 'image/png' });
  function paste(target: HTMLElement) {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: { files: [file], getData: () => 'image caption' },
    });
    target.dispatchEvent(event);
    return event;
  }
  expect(paste(editable).defaultPrevented).toBe(false);
  expect(pasteFiles).not.toHaveBeenCalled();
  expect(paste(host).defaultPrevented).toBe(true);
  expect(pasteFiles).toHaveBeenCalledWith([file]);
  expect(pasteText).not.toHaveBeenCalled();
  vi.stubGlobal('navigator', {
    clipboard: {
      read: async () => [{ types: ['image/png'], getType: async () => file }],
    },
  });
  await clipboard.paste();
  const uploaded = pasteFiles.mock.lastCall![0][0] as File;
  expect(uploaded.type).toBe('image/png');
  expect(uploaded.size).toBe(file.size);
  expect(editor.getSession().canUndo).toBe(false);
});

it('leaves native clipboard events owned by an active nested canvas alone', () => {
  const { editor, host, data, event } = setup();
  const embed = document.createElement('div');
  embed.dataset.canvasEmbedActive = 'nested';
  const innerCanvas = document.createElement('div');
  embed.append(innerCanvas);
  host.append(embed);
  editor.select('welcome-rectangle');
  data.set('text/plain', 'nested canvas data');
  for (const type of ['copy', 'cut', 'paste'])
    expect(event(type, innerCanvas).defaultPrevented).toBe(false);
  expect(drawableIds(editor.document)).toHaveLength(3);
  expect(editor.getSession().canUndo).toBe(false);
});
