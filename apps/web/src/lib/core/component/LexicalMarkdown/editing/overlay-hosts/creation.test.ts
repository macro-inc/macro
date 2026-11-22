// @vitest-environment jsdom
import type { PopoverSplitOptions } from '@components/app/split-layout/layoutManager';
import { AwaitNode, DocumentMentionNode } from '@macro-inc/lexical-core';
import { $createParagraphNode, $getRoot, $nodesOfType } from 'lexical';
import { afterEach, expect, test, vi } from 'vitest';
import { behaviorEditor } from '../../behavior-inventory/editor';
import { awaitPlugin } from '../../plugins/await/awaitPlugin';
import { mentionsPlugin } from '../../plugins/mentions/mentionsPlugin';
import {
  type CreationComposerCallbacks,
  openCreationComposer,
} from './creation';
import { openLexicalCreationComposer } from './lexical-creation';

// Only the popover/service boundaries are observed; commands and nodes stay real.
const BOUNDARY = vi.hoisted(() => ({
  available: true,
  request: vi.fn<(options: PopoverSplitOptions) => void>(),
  track: vi.fn<(source: string, kind: string, id: string) => Promise<string>>(),
}));
vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () =>
    BOUNDARY.available ? { createPopoverSplit: BOUNDARY.request } : undefined,
}));
vi.mock('@core/signal/mention', () => ({ trackMention: BOUNDARY.track }));
afterEach(() => {
  BOUNDARY.available = true;
  BOUNDARY.request.mockReset();
  BOUNDARY.track.mockReset();
});

function callbacks(): CreationComposerCallbacks {
  const request = BOUNDARY.request.mock.calls.at(-1)?.[0];
  if (!request || request.content.type !== 'component')
    throw new Error('Missing composer request');
  const start = request.content.params?.onCreateStart;
  const failure = request.content.params?.onCreateFailure;
  const success = request.content.params?.onSuccess;
  if (
    typeof start !== 'function' ||
    typeof failure !== 'function' ||
    typeof success !== 'function'
  )
    throw new Error('Missing actual composer callbacks');
  return {
    onCreateStart: (value) => start(value),
    onCreateFailure: () => failure(),
    onSuccess: (value) => success(value),
  };
}

test('missing manager creates no callback and reports no open request', () => {
  BOUNDARY.available = false;
  const createCallbacks = vi.fn<(id: string) => CreationComposerCallbacks>();
  expect(openCreationComposer('task', createCallbacks)).toBe(false);
  expect(createCallbacks).not.toHaveBeenCalled();
  expect(BOUNDARY.request).not.toHaveBeenCalled();
});

test('retained Source callbacks keep programmatic edits after editability changes', async () => {
  const { editor } = behaviorEditor(awaitPlugin(), mentionsPlugin({}));
  editor.update(() => $getRoot().append($createParagraphNode()).selectEnd(), {
    discrete: true,
  });
  expect(openLexicalCreationComposer(editor, undefined, 'task')).toBe(true);
  const request = callbacks();
  request.onCreateFailure();
  request.onCreateStart({ title: 'Created item', content: '' });
  editor.read(() => expect($nodesOfType(AwaitNode)).toHaveLength(1));
  editor.setEditable(false);
  await request.onSuccess({
    documentId: 'fixture-created',
    title: 'Created item',
    content: '',
  });
  editor.read(() => {
    expect($nodesOfType(AwaitNode)).toHaveLength(0);
    expect($nodesOfType(DocumentMentionNode)).toHaveLength(1);
    expect($nodesOfType(DocumentMentionNode)[0].exportJSON().documentId).toBe(
      'fixture-created'
    );
  });
});

test('a removed placeholder never constructs a replacement or falls back to insertion', async () => {
  const { editor } = behaviorEditor(awaitPlugin(), mentionsPlugin({}));
  editor.update(() => $getRoot().append($createParagraphNode()).selectEnd(), {
    discrete: true,
  });
  openLexicalCreationComposer(editor, undefined, 'document');
  const request = callbacks();
  request.onCreateStart({ title: 'Created item', content: '' });
  editor.update(
    () => $getRoot().clear().append($createParagraphNode()).selectEnd(),
    { discrete: true }
  );
  const before = JSON.stringify(editor.getEditorState());
  await request.onSuccess({
    documentId: 'fixture-created',
    title: 'Created item',
    content: '',
  });
  expect(JSON.stringify(editor.getEditorState())).toBe(before);
});

test('tracking finishes before selecting replacement or current-selection fallback', async () => {
  const { editor } = behaviorEditor(awaitPlugin(), mentionsPlugin({}));
  editor.update(() => $getRoot().append($createParagraphNode()).selectEnd(), {
    discrete: true,
  });
  const tracked = Promise.withResolvers<string>();
  BOUNDARY.track.mockReturnValue(tracked.promise);
  const context = { sourceDocumentId: 'fixture-source', sourceBlockName: 'md' };
  openLexicalCreationComposer(editor, context, 'task');
  const request = callbacks();
  request.onCreateStart({ title: 'Created item', content: '' });
  context.sourceDocumentId = 'fixture-current-source';
  const success = request.onSuccess({
    documentId: 'fixture-created',
    title: 'Created item',
    content: '',
  });
  expect(BOUNDARY.track).toHaveBeenCalledWith(
    'fixture-current-source',
    'document',
    'fixture-created'
  );
  editor.read(() => expect($nodesOfType(AwaitNode)).toHaveLength(1));
  request.onCreateFailure();
  tracked.resolve('fixture-mention');
  await success;
  editor.read(() => {
    expect($nodesOfType(AwaitNode)).toHaveLength(0);
    const mentions = $nodesOfType(DocumentMentionNode);
    expect(mentions).toHaveLength(1);
    expect(mentions[0].exportJSON().mentionUuid).toBe('fixture-mention');
  });
});

test('retained callbacks do not insert after their real command registrations retire', async () => {
  const { editor } = behaviorEditor();
  const stopAwait = awaitPlugin()(editor);
  const stopMentions = mentionsPlugin({})(editor);
  try {
    editor.update(() => $getRoot().append($createParagraphNode()).selectEnd(), {
      discrete: true,
    });
    openLexicalCreationComposer(editor, undefined, 'task');
    const request = callbacks();
    stopAwait();
    stopMentions();
    const before = JSON.stringify(editor.getEditorState());
    request.onCreateStart({ title: 'Created item', content: '' });
    request.onCreateFailure();
    await request.onSuccess({
      documentId: 'fixture-created',
      title: 'Created item',
      content: '',
    });
    expect(JSON.stringify(editor.getEditorState())).toBe(before);
  } finally {
    stopAwait();
    stopMentions();
  }
});
