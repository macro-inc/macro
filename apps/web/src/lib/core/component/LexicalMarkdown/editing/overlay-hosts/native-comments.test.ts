import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { locks } from 'node:worker_threads';
import * as native from '@core/document-session/wasm/document_session_wasm.js';
import {
  ABI_MAJOR,
  CommandCode,
} from '@macro-inc/collaboration/session/abi.generated';
import {
  createBuiltinRegistry,
  mountLocalSessionView,
  registerMacroElementViews,
} from '@macro-inc/lexical-wasm-view';
import { NOOP_SPAN } from '@macro-inc/observability';
import { createRoot } from 'solid-js';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createNativeComments } from './native-comments';

const previousLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
beforeAll(() => {
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: locks,
  });
  native.initSync({
    module: readFileSync(
      resolve(
        import.meta.dirname,
        '../../../../document-session/wasm/document_session_wasm_bg.wasm'
      )
    ),
  });
});
afterAll(() => {
  if (previousLocks) Object.defineProperty(navigator, 'locks', previousLocks);
  else Reflect.deleteProperty(navigator, 'locks');
});

const text = (value: string) => ({ type: 'text', version: 1, text: value });
const comment = (ids: string[], value: string) => ({
  type: 'comment-mark',
  version: 1,
  ids,
  isDraft: false,
  children: [text(value)],
});

function mount() {
  const root = document.createElement('div');
  document.body.append(root);
  const runtime = mountLocalSessionView(
    root,
    registerMacroElementViews(createBuiltinRegistry()),
    {
      namespace: 'native-comments',
      theme: {},
      editable: true,
      preset: 'rich',
      parentSpan: NOOP_SPAN,
      onError(error) {
        throw error;
      },
    },
    {
      viewEngine: 1,
      viewOs: 0,
      nativeCommands: native,
      create: (config, now, wall) =>
        native.EditorSession.createMacroWithNamespace(
          ABI_MAJOR,
          config,
          now,
          wall,
          'native-comments'
        ),
    }
  );
  runtime.port.setState(
    JSON.stringify({
      root: {
        type: 'root',
        version: 1,
        children: [
          {
            type: 'paragraph',
            version: 1,
            children: [
              text('one '),
              comment(['mark-a'], 'two'),
              text(' three '),
              comment(['mark-a', 'mark-b'], 'four'),
            ],
          },
        ],
      },
    })
  );
  return { ...runtime, root };
}

const textNode = (runtime: ReturnType<typeof mount>, value: string) => {
  const found = [...runtime.view.mirror.values()].find(
    (node) => node.kind === 'text' && node.text === value
  );
  if (!found) throw new Error('Missing native text ' + value);
  return found;
};
const caret = (
  runtime: ReturnType<typeof mount>,
  key: number,
  offset: number
) =>
  runtime.port.selectionFromView({
    kind: 'range',
    anchor: { key, offset, type: 'text' },
    focus: { key, offset, type: 'text' },
  });

test('anchors, caret marks and selection follow the native comment marks', async () => {
  const runtime = mount();
  await createRoot(async (dispose) => {
    const comments = createNativeComments(runtime.view);
    try {
      expect(
        comments
          .anchors()
          .map((anchor) => [
            anchor.markId,
            anchor.elements.map((element) => element.textContent),
          ])
      ).toEqual([
        ['mark-a', ['two', 'four']],
        ['mark-b', ['four']],
      ]);

      // Inside a mark, and at offset 0 just after one (Source boundary rule).
      caret(runtime, textNode(runtime, 'two').key, 1);
      expect(comments.caretMarkIds()).toEqual(['mark-a']);
      caret(runtime, textNode(runtime, ' three ').key, 0);
      expect(comments.caretMarkIds()).toEqual(['mark-a']);
      caret(runtime, textNode(runtime, ' three ').key, 3);
      expect(comments.caretMarkIds()).toEqual([]);
      caret(runtime, textNode(runtime, 'one ').key, 4);
      expect(comments.caretMarkIds()).toEqual(['mark-a']);

      comments.select(['mark-b']);
      expect(
        [...runtime.root.querySelectorAll('mark.selected')].map(
          (element) => element.textContent
        )
      ).toEqual(['four']);
      comments.select([]);
      expect(runtime.root.querySelectorAll('mark.selected')).toHaveLength(0);

      const one = textNode(runtime, 'one ');
      runtime.port.selectionFromView({
        kind: 'range',
        anchor: { key: one.key, offset: 0, type: 'text' },
        focus: { key: one.key, offset: 3, type: 'text' },
      });
      const bookmark = comments.captureSelection();
      expect(bookmark?.text).toBe('one');
      if (!bookmark) throw new Error('Missing bookmark');
      // No transport: the session cannot catch up, so it refuses.
      expect(await comments.publish('mark-c', bookmark)).toBe(false);
      expect(await comments.remove('mark-a')).toBe(false);

      // Source drafts follow their durable cursors through edits before them.
      caret(runtime, one.key, 0);
      runtime.port.command(CommandCode.InsertText, 0, 0, 'XY');
      expect(comments.resolveBookmark(bookmark)).toEqual({
        anchor: { key: one.key, offset: 2, type: 'text' },
        focus: { key: one.key, offset: 5, type: 'text' },
      });

      // An edit inside the range stays inside it.
      caret(runtime, one.key, 3);
      runtime.port.command(CommandCode.InsertText, 0, 0, 'Z');
      const widened = comments.resolveBookmark(bookmark);
      if (!widened) throw new Error('Missing resolved bookmark');
      runtime.port.selectionFromView({ kind: 'range', ...widened });
      expect(runtime.port.commentSelection()?.text).toBe('oZne');

      caret(runtime, one.key, 1);
      expect(comments.captureSelection()).toBeNull();
    } finally {
      comments.dispose();
      dispose();
      await runtime.close();
      runtime.root.remove();
    }
  });
});
