/**
 * Copy, cut, and paste of shapes, slides, text, and pictures.
 *
 * Shapes and slides travel as engine payloads (self-contained JSON with the
 * parts they use, so they paste into other decks too). The system clipboard
 * gets their text, plus an HTML marker naming the payload kept here, so
 * pasting back into a presentation restores the shapes rather than text.
 */

import type { PresentationEngine } from '../context/pptx-editor-context';
import type { EditorCommands } from './create-editor-commands';
import type { PresentationSession } from './create-presentation-session';
import type { SlideEditor } from './create-slide-editor';

const MARKER = 'data-macro-pptx-clip';

interface Clip {
  token: string;
  kind: 'shapes' | 'slides';
  /** The engine payload. */
  payload: Promise<string>;
  /** Pastes so far, to offset repeated pastes onto the same slide. */
  pastes: number;
  /** Where the shapes came from. */
  slide?: number;
}

/** One clipboard per tab, shared by every open presentation. */
let current: Clip | undefined;

function newToken() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function markerHtml(token: string, text: string) {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<meta charset="utf-8"><span ${MARKER}="${token}">${escaped || '&nbsp;'}</span>`;
}

function tokenIn(html: string | undefined): string | undefined {
  if (!html) return undefined;
  return new RegExp(`${MARKER}="([^"]+)"`).exec(html)?.[1];
}

export interface ClipboardOptions {
  engine: PresentationEngine;
  session: PresentationSession;
  editor: SlideEditor;
  commands: EditorCommands;
  notifyError: (message: string) => void;
  /** Slide ids selected in the slide rail, when it has focus. */
  railSelection: () => number[] | undefined;
}

export function createClipboard(options: ClipboardOptions) {
  const { engine, session, editor, commands } = options;

  const shapesText = () =>
    editor
      .selection()
      .flatMap((s) => [
        ...(s.paragraphs ?? []).map((p) => p.text.replaceAll('\u000b', '\n')),
        ...(s.table?.rows ?? []).map((r) => r.join('\t')),
      ])
      .join('\n');

  /** Copies the selection into `data` (a copy event's), or the async clipboard. */
  function copy(data?: DataTransfer | null): boolean {
    const slides = options.railSelection();
    if (slides && slides.length > 0) {
      const token = newToken();
      current = {
        token,
        kind: 'slides',
        payload: engine.copySlides(slides),
        pastes: 0,
      };
      write(data, token, '');
      return true;
    }
    const s = session.currentSlide();
    const shapes = editor.selection();
    if (!s || shapes.length === 0) return false;
    const token = newToken();
    current = {
      token,
      kind: 'shapes',
      payload: engine.copyShapes(
        s.index,
        shapes.map((x) => x.id)
      ),
      pastes: 0,
      slide: s.id,
    };
    current.payload.catch(() => {
      options.notifyError('Those shapes could not be copied.');
    });
    write(data, token, shapesText());
    return true;
  }

  function write(
    data: DataTransfer | null | undefined,
    token: string,
    text: string
  ) {
    if (data) {
      data.setData('text/plain', text);
      data.setData('text/html', markerHtml(token, text));
      return;
    }
    // Called from a button: no copy event to write into.
    try {
      void navigator.clipboard
        ?.write([
          new ClipboardItem({
            'text/plain': new Blob([text], { type: 'text/plain' }),
            'text/html': new Blob([markerHtml(token, text)], {
              type: 'text/html',
            }),
          }),
        ])
        .catch(() => {});
    } catch {
      // The in-tab clipboard still works.
    }
  }

  async function cut(data?: DataTransfer | null) {
    const slides = options.railSelection();
    if (!copy(data)) return;
    if (slides && slides.length > 0) await commands.deleteSlides(slides);
    else await editor.deleteSelected();
  }

  /** Pastes our own payload; returns false when the token is not ours. */
  async function pasteClip(token: string | undefined): Promise<boolean> {
    const clip = current;
    if (!clip || (token !== undefined && token !== clip.token)) return false;
    const s = session.currentSlide();
    if (!s) return true;
    let payload: string;
    try {
      payload = await clip.payload;
    } catch {
      return true;
    }
    clip.pastes++;
    if (clip.kind === 'slides') {
      const result = await session.apply([
        { op: 'pasteSlides', after: s.id, payload },
      ]);
      const first = result?.created[0]?.slide;
      if (first !== undefined) commands.goToSlideId(first);
      return true;
    }
    // Pasting onto the source slide offsets each copy, as PowerPoint does.
    const offset = clip.slide === s.id ? 12 * clip.pastes : 0;
    const result = await session.apply([
      {
        op: 'pasteShapes',
        slide: s.id,
        payload,
        dx: offset,
        dy: offset,
      },
    ]);
    const ids = (result?.created ?? [])
      .filter((c) => c.slide === s.id && c.shape !== undefined)
      .map((c) => c.shape!);
    if (ids.length > 0) editor.setSelection(ids);
    return true;
  }

  /** Pastes a picture or text from outside (a new picture or text box). */
  async function pasteForeign(files: File[], text: string | undefined) {
    const image = files.find((f) => f.type.startsWith('image/'));
    if (image) {
      await commands.insertImage(image, image.name || 'Picture');
      return;
    }
    if (!text) return;
    const s = session.currentSlide();
    if (!s) return;
    const size = { w: 400, h: 60 };
    const result = await session.apply([
      {
        op: 'addShape',
        slide: s.id,
        shape: { kind: 'textBox', text: text.replace(/\r\n?/g, '\n') },
        x: 60,
        y: 60,
        ...size,
      },
    ]);
    const id = result?.created[0]?.shape;
    if (id !== undefined) editor.select(id);
  }

  /** Handles a paste event on the stage (not while typing). */
  async function pasteEvent(data: DataTransfer | null) {
    if (!data) return;
    const token = tokenIn(data.getData('text/html'));
    if (token && (await pasteClip(token))) return;
    await pasteForeign([...data.files], data.getData('text/plain'));
  }

  /** Paste from a button or menu: reads the async clipboard when allowed. */
  async function pasteCommand() {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        if (item.types.includes('text/html')) {
          const html = await (await item.getType('text/html')).text();
          const token = tokenIn(html);
          if (token && (await pasteClip(token))) return;
        }
      }
      const files: File[] = [];
      let text: string | undefined;
      for (const item of items) {
        const image = item.types.find((t) => t.startsWith('image/'));
        if (image)
          files.push(
            new File([await item.getType(image)], 'Picture', { type: image })
          );
        else if (item.types.includes('text/plain'))
          text = await (await item.getType('text/plain')).text();
      }
      if (editor.editing() && text) {
        await editor.typeText(text);
        return;
      }
      await pasteForeign(files, text);
    } catch {
      // No clipboard permission: what this tab copied still pastes.
      await pasteClip(undefined);
    }
  }

  return {
    copy,
    cut,
    pasteEvent,
    pasteCommand,
    /** Whether this tab holds something to paste. */
    hasClip: () => !!current,
  };
}

export type PresentationClipboard = ReturnType<typeof createClipboard>;
