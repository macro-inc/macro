import {
  copyFragment,
  type GraphicsEditor,
  parseFragment,
  pasteCommand,
} from '@macro-inc/graphics';

const mime = 'application/x-macro-graphics';
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
  pasteFiles?: (files: File[]) => void
) {
  let pastedText = '',
    pasteCount = 0;
  const serialize = () => {
    const fragment = copyFragment(
      editor.document,
      editor.getSession().selectedIds
    );
    return fragment ? JSON.stringify(fragment) : undefined;
  };
  const paste = (text: string, html?: string) => {
    const fragment = parseFragment(text);
    if (!fragment) {
      if (pasteText && text.trim()) {
        pasteText(text, html);
        notify('Pasted text');
        return true;
      }
      notify('Clipboard has no Canvas Next shapes');
      return false;
    }
    pasteCount = text === pastedText ? pasteCount + 1 : 1;
    pastedText = text;
    editor.execute(pasteCommand, {
      fragment,
      createId: () => crypto.randomUUID(),
      offset: { x: 24 * pasteCount, y: 24 * pasteCount },
    });
    notify('Pasted selection');
    return true;
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
    async paste() {
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
          else paste(text, html);
        } else paste(await navigator.clipboard.readText());
      } catch {
        notify('Clipboard permission denied. Use the paste keyboard shortcut.');
      }
    },
    attach(element: HTMLElement) {
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
            event.clipboardData.getData('text/html')
          )
        ) {
          event.preventDefault();
          event.stopPropagation();
        }
      };
      element.addEventListener('copy', write);
      element.addEventListener('cut', write);
      element.addEventListener('paste', read);
      return () => {
        element.removeEventListener('copy', write);
        element.removeEventListener('cut', write);
        element.removeEventListener('paste', read);
      };
    },
  };
}
export type CanvasClipboard = ReturnType<typeof createCanvasClipboard>;
