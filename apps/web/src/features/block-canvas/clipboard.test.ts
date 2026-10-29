import {
  copyFragment,
  createGraphicsEditor,
  drawableIds,
  screenToWorld,
  selectAllCommand,
  setShapeLabelCommand,
  worldBounds,
} from '@macro-inc/graphics';
import { afterEach, expect, it, vi } from 'vitest';
import { createCanvasClipboard } from './clipboard';
import { createCanvasNextScene } from './core/seed-scene';
import { plainRichText } from './core/text-codec';

const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.splice(0).forEach((fn) => fn());
  vi.unstubAllGlobals();
});

function setup(canvasId = 'canvas-a') {
  const editor = createGraphicsEditor(createCanvasNextScene());
  const host = document.createElement('div');
  const input = document.createElement('input');
  host.append(input);
  const notify = vi.fn();
  const center = () => screenToWorld(editor.getCamera(), { x: 400, y: 300 });
  const clipboard = createCanvasClipboard(
    editor,
    notify,
    undefined,
    undefined,
    { canvasId, center }
  );
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
  return { editor, input, host, data, event, clipboard, notify, center };
}

function selectedBounds(editor: ReturnType<typeof createGraphicsEditor>) {
  const fragment = copyFragment(
    editor.document,
    editor.getSession().selectedIds
  )!;
  return worldBounds(fragment.scene, fragment.scene.rootId);
}

it('centers cross-canvas selections in the current viewport, preserving their relative layout', () => {
  const source = setup('source');
  source.editor.execute(selectAllCommand, undefined);
  const original = selectedBounds(source.editor);
  source.event('copy');
  const target = setup('target');
  target.editor.zoomAt({ x: 0, y: 0 }, 2);
  target.editor.panBy({ x: 1000, y: -500 });
  target.editor.setSnapUnit(100);
  target.data.set('text/plain', source.data.get('text/plain')!);
  target.event('paste');
  const bounds = selectedBounds(target.editor);
  expect(bounds.width).toBe(original.width);
  expect(bounds.height).toBe(original.height);
  expect(bounds.x + bounds.width / 2).toBe(target.center().x);
  expect(bounds.y + bounds.height / 2).toBe(target.center().y);
  target.event('paste');
  expect(selectedBounds(target.editor)).toEqual(bounds);
  target.editor.undo();
  expect(drawableIds(target.editor.document)).toHaveLength(6);
  target.editor.redo();
  expect(drawableIds(target.editor.document)).toHaveLength(9);
});

it('recognizes copies from another instance of the same canvas', () => {
  const source = setup();
  source.editor.select('welcome-rectangle');
  source.event('copy');
  const target = setup();
  target.data.set('text/plain', source.data.get('text/plain')!);
  target.event('paste');
  expect(selectedBounds(target.editor)).toMatchObject({ x: 124, y: 124 });
});

it('centers old fragments without source metadata as external spatial data', () => {
  const { editor, event, data, center } = setup();
  data.set(
    'text/plain',
    JSON.stringify(copyFragment(editor.document, ['welcome-small']))
  );
  event('paste');
  const bounds = selectedBounds(editor);
  expect(bounds.x + bounds.width / 2).toBe(center().x);
  expect(bounds.y + bounds.height / 2).toBe(center().y);
});

it('Shift-pastes exactly in place without snapping or advancing the same-canvas offset', () => {
  const { editor, event, host } = setup();
  editor.select('welcome-small');
  const original = selectedBounds(editor);
  event('copy');
  event('paste');
  editor.setSnapUnit(100);
  host.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'v', metaKey: true, shiftKey: true })
  );
  event('paste');
  expect(selectedBounds(editor)).toEqual(original);
  host.dispatchEvent(
    new KeyboardEvent('keyup', { key: 'Shift', shiftKey: false })
  );
  editor.setSnapUnit(undefined);
  event('paste');
  expect(selectedBounds(editor)).toMatchObject({
    x: original.x + 48,
    y: original.y + 48,
  });
});

it('centers grouped Excalidraw shapes and supports paste in place through the clipboard API', async () => {
  const { editor, data, event, center, clipboard } = setup();
  const text = JSON.stringify({
    type: 'excalidraw/clipboard',
    elements: [
      {
        id: 'a',
        type: 'rectangle',
        x: 101,
        y: 203,
        width: 100,
        height: 80,
        angle: Math.PI / 4,
        groupIds: ['group'],
      },
      {
        id: 'b',
        type: 'ellipse',
        x: 401,
        y: 503,
        width: 100,
        height: 80,
        groupIds: ['group'],
      },
    ],
  });
  data.set('text/plain', text);
  event('paste');
  const centered = selectedBounds(editor);
  expect(centered.x + centered.width / 2).toBeCloseTo(center().x);
  expect(centered.y + centered.height / 2).toBeCloseTo(center().y);
  vi.stubGlobal('navigator', { clipboard: { readText: async () => text } });
  editor.setSnapUnit(100);
  await clipboard.paste(true);
  const inPlace = selectedBounds(editor);
  expect(inPlace.width).toBeCloseTo(centered.width);
  expect(inPlace.height).toBeCloseTo(centered.height);
  expect(inPlace.x).toBeCloseTo(151 - 90 / Math.sqrt(2));
  expect(inPlace.y).toBeCloseTo(243 - 90 / Math.sqrt(2));
});

it('clears held modifiers when the canvas loses focus', () => {
  const { editor, event, host } = setup();
  editor.select('welcome-rectangle');
  event('copy');
  host.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true })
  );
  host.dispatchEvent(new FocusEvent('focusout'));
  event('paste');
  expect(selectedBounds(editor)).toMatchObject({ x: 124, y: 124 });
});

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

it.each([plainRichText('Pasted label'), '{broken'])(
  'validates host text when importing shape fragments (%s)',
  (content) => {
    const { editor, event, notify } = setup();
    editor.execute(setShapeLabelCommand, {
      id: 'welcome-rectangle',
      label: { content, fontSize: 24, fontFamily: 'sans', height: 32 },
    });
    event('copy');
    const before = editor.document;
    event('paste');
    if (content === '{broken') {
      expect(editor.document).toBe(before);
      expect(notify).toHaveBeenLastCalledWith(
        'Clipboard has invalid Canvas Next text'
      );
    } else {
      expect(
        editor.document.items[editor.getSession().selectedId!]
      ).toMatchObject({ geometry: { label: { content } } });
      expect(drawableIds(editor.document)).toHaveLength(4);
    }
  }
);

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
