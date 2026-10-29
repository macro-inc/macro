import {
  copyFragment,
  type GraphicsEditor,
  type GraphicsFragment,
  type Point,
  parseFragment,
  pasteCommand,
  screenToWorld,
  worldBounds,
} from '@macro-inc/graphics';
import { importExcalidraw } from './core/excalidraw';
import { validCanvasTextDocument } from './core/text-codec';

const mime = 'application/x-macro-graphics';
// Exact placement must not be shifted by the destination canvas's snap grid.
const pasteAtPositionCommand: typeof pasteCommand = {
  ...pasteCommand,
  apply: (context, payload) =>
    pasteCommand.apply({ ...context, snapUnit: undefined }, payload),
};
const editingText = (target: EventTarget | null) =>
  target instanceof Element &&
  !!target.closest(
    '[data-canvas-embed-active], input, textarea, select, [contenteditable]:not([contenteditable="false"])'
  );

/** OS clipboard and DOM events belong to the host, never to graphics core. */
export function createCanvasClipboard(
  editor: GraphicsEditor,
  notify: (message: string) => void,
  pasteText?: (text: string, html?: string) => void,
  pasteFiles?: (files: File[]) => void,
  placement?: { canvasId: string; center: () => Point }
) {
  const canvasId = placement?.canvasId ?? crypto.randomUUID();
  let viewport: HTMLElement | undefined;
  let pastedText = '',
    pasteCount = 0;
  const serialize = () => {
    const fragment = copyFragment(
      editor.document,
      editor.getSession().selectedIds
    );
    return fragment
      ? JSON.stringify({ ...fragment, sourceCanvasId: canvasId })
      : undefined;
  };
  const insert = (
    fragment: GraphicsFragment,
    text: string,
    sameCanvas: boolean,
    inPlace: boolean
  ) => {
    if (!validCanvasTextDocument(fragment.scene)) {
      notify('Clipboard has invalid Canvas Next text');
      return false;
    }
    let offset: Point = { x: 0, y: 0 };
    if (!inPlace && sameCanvas) {
      pasteCount = text === pastedText ? pasteCount + 1 : 1;
      pastedText = text;
      offset = { x: 24 * pasteCount, y: 24 * pasteCount };
    } else if (!inPlace) {
      const center =
        placement?.center() ??
        screenToWorld(editor.getCamera(), {
          x: (viewport?.clientWidth ?? 0) / 2,
          y: (viewport?.clientHeight ?? 0) / 2,
        });
      const bounds = worldBounds(fragment.scene, fragment.scene.rootId);
      offset = {
        x: center.x - (bounds.x + bounds.width / 2),
        y: center.y - (bounds.y + bounds.height / 2),
      };
    }
    editor.execute(
      sameCanvas && !inPlace ? pasteCommand : pasteAtPositionCommand,
      {
        fragment,
        createId: () => crypto.randomUUID(),
        offset,
      }
    );
    return true;
  };
  const paste = (text: string, html?: string, inPlace = false) => {
    const fragment = parseFragment(text);
    if (fragment) {
      const metadata: { sourceCanvasId?: unknown } = JSON.parse(text);
      const pasted = insert(
        fragment,
        text,
        metadata.sourceCanvasId === canvasId,
        inPlace
      );
      if (pasted) notify('Pasted selection');
      return pasted;
    }
    const excalidraw = importExcalidraw(text);
    if (excalidraw) {
      const pasted = insert(excalidraw.fragment, text, false, inPlace);
      if (pasted) notify(excalidrawNotice(excalidraw));
      return pasted;
    }
    if (pasteText && text.trim()) {
      pasteText(text, html);
      notify('Pasted text');
      return true;
    }
    notify('Clipboard has no Canvas Next shapes');
    return false;
  };
  async function copy(cut = false) {
    const text = serialize();
    if (!text) return;
    const document = editor.document,
      selection = editor.getSession().selectedIds.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      pastedText = '';
      pasteCount = 0;
      if (
        cut &&
        editor.document === document &&
        editor.getSession().selectedIds.join('\n') === selection
      )
        editor.deleteSelection();
      notify(cut ? 'Cut selection' : 'Copied selection');
    } catch {
      notify('Clipboard permission denied. Use the keyboard shortcut instead.');
    }
  }
  return {
    copy: () => copy(),
    cut: () => copy(true),
    async paste(inPlace = false) {
      try {
        if (pasteFiles && navigator.clipboard.read) {
          const items = await navigator.clipboard.read();
          const files: File[] = [];
          let text = '',
            html = '';
          for (const item of items) {
            const media = item.types.find(
              (type) => type.startsWith('image/') || type.startsWith('video/')
            );
            if (media)
              files.push(
                new File(
                  [await item.getType(media)],
                  `Pasted.${media.split('/')[1]}`,
                  { type: media }
                )
              );
            else {
              if (item.types.includes('text/plain'))
                text = await (await item.getType('text/plain')).text();
              if (item.types.includes('text/html'))
                html = await (await item.getType('text/html')).text();
            }
          }
          if (files.length) pasteFiles(files);
          else paste(text, html, inPlace);
        } else paste(await navigator.clipboard.readText(), undefined, inPlace);
      } catch {
        notify('Clipboard permission denied. Use the paste keyboard shortcut.');
      }
    },
    attach(element: HTMLElement) {
      viewport = element;
      // ClipboardEvent has no modifier keys; capture them from native keyboard events.
      let shiftHeld = false;
      const modifiers = (event: KeyboardEvent) => {
        shiftHeld = event.shiftKey;
      };
      const resetModifiers = () => {
        shiftHeld = false;
      };
      const write = (event: ClipboardEvent) => {
        if (
          event.defaultPrevented ||
          editingText(event.target) ||
          !event.clipboardData
        )
          return;
        const text = serialize();
        if (!text) return;
        event.clipboardData.setData(mime, text);
        event.clipboardData.setData('text/plain', text);
        event.preventDefault();
        event.stopPropagation();
        pastedText = '';
        pasteCount = 0;
        if (event.type === 'cut') editor.deleteSelection();
        notify(event.type === 'cut' ? 'Cut selection' : 'Copied selection');
      };
      const read = (event: ClipboardEvent) => {
        if (
          event.defaultPrevented ||
          editingText(event.target) ||
          !event.clipboardData
        )
          return;
        if (pasteFiles && event.clipboardData.files.length) {
          event.preventDefault();
          event.stopPropagation();
          pasteFiles(Array.from(event.clipboardData.files));
          return;
        }
        if (
          paste(
            event.clipboardData.getData(mime) ||
              event.clipboardData.getData('text/plain'),
            event.clipboardData.getData('text/html'),
            shiftHeld
          )
        ) {
          event.preventDefault();
          event.stopPropagation();
        }
      };
      element.addEventListener('copy', write);
      element.addEventListener('cut', write);
      element.addEventListener('paste', read);
      element.addEventListener('keydown', modifiers, true);
      element.addEventListener('keyup', modifiers, true);
      element.addEventListener('focusout', resetModifiers);
      window.addEventListener('blur', resetModifiers);
      return () => {
        element.removeEventListener('copy', write);
        element.removeEventListener('cut', write);
        element.removeEventListener('paste', read);
        element.removeEventListener('keydown', modifiers, true);
        element.removeEventListener('keyup', modifiers, true);
        element.removeEventListener('focusout', resetModifiers);
        window.removeEventListener('blur', resetModifiers);
        if (viewport === element) viewport = undefined;
      };
    },
  };
}
export type CanvasClipboard = ReturnType<typeof createCanvasClipboard>;

function excalidrawNotice(result: ReturnType<typeof importExcalidraw>): string {
  if (!result) return 'Pasted selection';
  const extras: string[] = [];
  if (result.approximated) extras.push(`${result.approximated} approximated`);
  if (result.skipped) extras.push(`${result.skipped} unsupported`);
  const shapes = `${result.imported} Excalidraw ${result.imported === 1 ? 'shape' : 'shapes'}`;
  return extras.length
    ? `Imported ${shapes} (${extras.join(', ')})`
    : `Imported ${shapes}`;
}
