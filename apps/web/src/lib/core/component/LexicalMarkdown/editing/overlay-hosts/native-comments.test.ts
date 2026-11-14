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
import { NOOP_SPAN, Telemetry } from '@macro-inc/observability';
import { createRoot } from 'solid-js';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
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

test('publication and removal wait for a drained flush, as Source does', async () => {
  const runtime = mount();
  await createRoot(async (dispose) => {
    const comments = createNativeComments(runtime.view);
    try {
      const one = textNode(runtime, 'one ');
      runtime.port.selectionFromView({
        kind: 'range',
        anchor: { key: one.key, offset: 0, type: 'text' },
        focus: { key: one.key, offset: 3, type: 'text' },
      });
      const bookmark = comments.captureSelection();
      if (!bookmark) throw new Error('Missing bookmark');
      const order: string[] = [];
      const flush = runtime.port.flush.bind(runtime.port);
      const comment = runtime.port.comment.bind(runtime.port);
      const flushSpy = vi
        .spyOn(runtime.port, 'flush')
        .mockImplementation(() => {
          order.push('flush');
          return flush();
        });
      const commentSpy = vi
        .spyOn(runtime.port, 'comment')
        .mockImplementation((...args) => {
          order.push('comment');
          return comment(...args);
        });
      await comments.publish('mark-c', bookmark);
      await comments.remove('mark-a');
      expect(order).toEqual(['flush', 'comment', 'flush', 'comment']);

      // Undelivered local edits refuse publication without a comment request.
      flushSpy.mockResolvedValue({ kind: 'not-drained', undelivered: 1 });
      order.length = 0;
      expect(await comments.publish('mark-c', bookmark)).toBe(false);
      expect(await comments.remove('mark-a')).toBe(false);
      expect(commentSpy).toHaveBeenCalledTimes(2);

      // Each refusal is reported with its reason, as Source does.
      const warn = vi.spyOn(Telemetry, 'warn');
      expect(await comments.publish('mark-c', bookmark)).toBe(false);
      expect(warn).toHaveBeenCalledWith('comment.mark.publication_failed', {
        'comment.mark_id': 'mark-c',
        'comment.action': 'add',
        'comment.reason': 'not_flushed',
      });
      flushSpy.mockResolvedValue({ kind: 'drained' });
      commentSpy.mockResolvedValue({ kind: 'not-acked' });
      expect(await comments.publish('mark-c', bookmark)).toBe(false);
      expect(warn).toHaveBeenLastCalledWith('comment.mark.publication_failed', {
        'comment.mark_id': 'mark-c',
        'comment.action': 'add',
        'comment.reason': 'not_acked',
      });
      warn.mockRestore();
    } finally {
      comments.dispose();
      dispose();
      await runtime.close();
      runtime.root.remove();
    }
  });
});

test('a mark request is not sent once the comments retire during the flush', async () => {
  const runtime = mount();
  await createRoot(async (dispose) => {
    const comments = createNativeComments(runtime.view);
    try {
      const one = textNode(runtime, 'one ');
      runtime.port.selectionFromView({
        kind: 'range',
        anchor: { key: one.key, offset: 0, type: 'text' },
        focus: { key: one.key, offset: 3, type: 'text' },
      });
      const bookmark = comments.captureSelection();
      if (!bookmark) throw new Error('Missing bookmark');
      const comment = vi.spyOn(runtime.port, 'comment');
      const drains: (() => void)[] = [];
      vi.spyOn(runtime.port, 'flush').mockImplementation(
        () =>
          new Promise((resolve) => {
            drains.push(() => resolve({ kind: 'drained' }));
          })
      );
      // Source changeCommentMark checks its owner is still active after staging.
      const publishing = comments.publish('mark-c', bookmark);
      const removing = comments.remove('mark-a');
      comments.dispose();
      for (const drain of drains) drain();
      expect(await publishing).toBe(false);
      expect(await removing).toBe(false);
      expect(comment).not.toHaveBeenCalled();
    } finally {
      comments.dispose();
      dispose();
      await runtime.close();
      runtime.root.remove();
    }
  });
});

test('a mark request is not sent once the key generation is replaced during the flush', async () => {
  const runtime = mount();
  await createRoot(async (dispose) => {
    const comments = createNativeComments(runtime.view);
    try {
      const one = textNode(runtime, 'one ');
      runtime.port.selectionFromView({
        kind: 'range',
        anchor: { key: one.key, offset: 0, type: 'text' },
        focus: { key: one.key, offset: 3, type: 'text' },
      });
      const bookmark = comments.captureSelection();
      if (!bookmark) throw new Error('Missing bookmark');
      const comment = vi.spyOn(runtime.port, 'comment');
      const drains: (() => void)[] = [];
      vi.spyOn(runtime.port, 'flush').mockImplementation(
        () =>
          new Promise((resolve) => {
            drains.push(() => resolve({ kind: 'drained' }));
          })
      );
      const generation = runtime.view.mirror.keyGeneration;
      const publishing = comments.publish('mark-c', bookmark);
      const removing = comments.remove('mark-a');
      // Synthetic stand-in for a mirror re-initialize, the only path that
      // replaces the key generation (a reset or resync rebinds the view).
      if (generation === null) throw new Error('Missing key generation');
      vi.spyOn(runtime.view.mirror, 'keyGeneration', 'get').mockReturnValue(
        generation + 1
      );
      for (const drain of drains) drain();
      expect(await publishing).toBe(false);
      expect(await removing).toBe(false);
      expect(comment).not.toHaveBeenCalled();
    } finally {
      comments.dispose();
      dispose();
      await runtime.close();
      runtime.root.remove();
    }
  });
});

// Query outcome is controlled; this tests the real consumer's owner gate only.
test('draft text refuses disposed and stale generation without querying the session', async () => {
  const runtime = mount();
  await createRoot(async (dispose) => {
    const comments = createNativeComments(runtime.view);
    const query = vi
      .spyOn(runtime.port, 'commentDraftText')
      .mockReturnValue('current');
    const generation = vi.spyOn(runtime.view.mirror, 'keyGeneration', 'get');
    try {
      const one = textNode(runtime, 'one ');
      runtime.port.selectionFromView({
        kind: 'range',
        anchor: { key: one.key, offset: 0, type: 'text' },
        focus: { key: one.key, offset: 3, type: 'text' },
      });
      const bookmark = comments.captureSelection();
      if (!bookmark) throw new Error('Missing bookmark');
      expect(comments.draftText('quote', bookmark)).toBe('current');
      expect(query).toHaveBeenCalledTimes(1);
      generation.mockReturnValue(bookmark.generation + 1);
      expect(comments.draftText('quote', bookmark)).toBeUndefined();
      expect(query).toHaveBeenCalledTimes(1);
      generation.mockReturnValue(bookmark.generation);
      comments.dispose();
      expect(comments.draftText('quote', bookmark)).toBeUndefined();
      expect(query).toHaveBeenCalledTimes(1);
    } finally {
      generation.mockRestore();
      query.mockRestore();
      comments.dispose();
      dispose();
      await runtime.close();
      runtime.root.remove();
    }
  });
});

/** The Source control's caret table (caret-mode.source-controls.test.tsx,
 *  `$getMarkIdsAtCaret` at each caret placement), over the same paragraph:
 *  "Before ", a comment mark (`ids`) around "marked", " after". */
async function caretTable(ids: string[]) {
  const runtime = mount();
  runtime.port.setState(
    JSON.stringify({
      root: {
        type: 'root',
        version: 1,
        children: [
          {
            type: 'paragraph',
            version: 1,
            children: [text('Before '), comment(ids, 'marked'), text(' after')],
          },
        ],
      },
    })
  );
  return createRoot(async (dispose) => {
    const comments = createNativeComments(runtime.view);
    try {
      const before = textNode(runtime, 'Before ');
      const marked = textNode(runtime, 'marked');
      const after = textNode(runtime, ' after');
      if (marked.parent === null || before.parent === null)
        throw new Error('Unexpected seed shape');
      const at = (key: number, offset: number, type: 'text' | 'element') =>
        comments.caretCommentIds({
          kind: 'range',
          anchor: { key, offset, type },
          focus: { key, offset, type },
        });
      return {
        insideMark: at(marked.key, 2, 'text'),
        textEndBeforeMark: at(before.key, 7, 'text'),
        offsetZeroAfterMark: at(after.key, 0, 'text'),
        markElement: at(marked.parent, 1, 'element'),
        outside: at(before.key, 2, 'text'),
        paragraphElement: at(before.parent, 3, 'element'),
        noSelection: comments.caretCommentIds({ kind: 'none' }),
      };
    } finally {
      comments.dispose();
      dispose();
      await runtime.close();
      runtime.root.remove();
    }
  });
}

test('caretCommentIds is Source $getMarkIdsAtCaret at each caret placement', async () => {
  expect(await caretTable(['mark-a'])).toEqual({
    insideMark: ['mark-a'],
    textEndBeforeMark: ['mark-a'],
    offsetZeroAfterMark: ['mark-a'],
    markElement: ['mark-a'],
    outside: null,
    paragraphElement: null,
    noSelection: null,
  });
  // An id-less mark: [] (not null), so `!= null` admits it, as Source.
  expect(await caretTable([])).toEqual({
    insideMark: [],
    textEndBeforeMark: [],
    offsetZeroAfterMark: [],
    markElement: [],
    outside: null,
    paragraphElement: null,
    noSelection: null,
  });
});

test('caretMarkIds keeps the Source $selectMarksAtCaret outcome its caller depends on', async () => {
  // NativeMessageCommentsProvider (selectMarksAtCaret): null returns early and
  // leaves the selected marks; [] clears them. Unchanged by caretCommentIds.
  const runtime = mount();
  await createRoot(async (dispose) => {
    const comments = createNativeComments(runtime.view);
    try {
      caret(runtime, textNode(runtime, 'two').key, 1);
      expect(comments.caretMarkIds()).toEqual(['mark-a']);
      // The caret leaves the comment: clear (not null).
      caret(runtime, textNode(runtime, ' three ').key, 3);
      expect(comments.caretMarkIds()).toEqual([]);
      const outside = runtime.view.selection().selection;
      expect(comments.caretCommentIds(outside)).toBeNull();
      // No selection: leave the current state.
      runtime.port.selectionFromView({ kind: 'none' });
      expect(comments.caretMarkIds()).toBeNull();
    } finally {
      comments.dispose();
      dispose();
      await runtime.close();
      runtime.root.remove();
    }
  });
});
