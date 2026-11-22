/** @vitest-environment jsdom */
import {
  $convertCardToMention,
  $isDocumentCardNode,
  DocumentCardNode,
  DocumentMentionNode,
} from '@macro-inc/lexical-core';
import { registerMacroDecoratorViews } from '@macro-inc/lexical-wasm-view/view/node-views/macro';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from '@macro-inc/lexical-wasm-view/view/test/native-surface';
import { $getRoot, createEditor } from 'lexical';
import { createRoot } from 'solid-js';
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { createNativeDocumentCardContext } from './native-document-card-host';

beforeAll(initializeNativeSurfaceTests);
// A converted mention stamps its creation time.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(1_700_000_000_000);
});
afterEach(() => {
  vi.useRealTimers();
});

const CARD = {
  type: 'document-card',
  version: 1,
  documentId: 'fixture-database',
  documentName: 'Fixture Database',
  blockName: 'database',
  blockParams: { view: 'table' },
  previewBox: ['100%', '400px'],
};

type NativeCardHost = ReturnType<
  typeof createNativeDocumentCardContext
>['host'];

const PARAGRAPH = { type: 'paragraph', version: 1, children: [] };

function stored(lead: object = PARAGRAPH) {
  return JSON.stringify({
    root: {
      type: 'root',
      version: 1,
      // Native keeps a paragraph after a trailing card; store one so both
      // engines start from the same blocks.
      children: [lead, CARD, PARAGRAPH],
    },
  });
}

/** The document Source stores after running a card action body. */
function source(
  action: (card: DocumentCardNode) => void,
  lead: object = PARAGRAPH
) {
  const editor = createEditor({
    nodes: [DocumentCardNode, DocumentMentionNode],
    onError(error) {
      throw error;
    },
  });
  editor.setEditorState(editor.parseEditorState(stored(lead)));
  editor.update(
    () => {
      const card = $getRoot().getChildren().find($isDocumentCardNode);
      if (!card) throw new Error('Missing actual Source card');
      action(card);
    },
    { discrete: true }
  );
  return imported(JSON.stringify(editor.getEditorState().toJSON()));
}

function registerCardViews(
  registry: ReturnType<typeof nativeSurface>['view']['registry']
) {
  registerMacroDecoratorViews(registry, {
    'document-card': () => document.createTextNode('Card'),
    'document-mention': () => document.createTextNode('Mention'),
  });
}

/** A stored document as native imports it, without its session node ids. */
function imported(state: string) {
  const fixture = nativeSurface();
  registerCardViews(fixture.view.registry);
  try {
    fixture.port.setState(state);
    return withoutIds(fixture.view.query.serializedState());
  } finally {
    fixture.close();
  }
}

/**
 * Session node ids (`$.id`) are minted per session, so they never match across
 * two. Every other node state slot stays in the comparison.
 */
function withoutIds(state: string): unknown {
  return JSON.parse(state, (key, value: unknown) => {
    if (key !== '$' || typeof value !== 'object' || value === null)
      return value;
    return Object.fromEntries(
      Object.entries(value).filter(([slot]) => slot !== 'id')
    );
  });
}

/** The document native stores after running a card action through its host. */
function native(
  action: (host: NativeCardHost, key: string) => void,
  lead: object = PARAGRAPH
) {
  const fixture = nativeSurface();
  const context = createRoot((dispose) => ({
    ...createNativeDocumentCardContext({}, { isInteractable: () => true }),
    disposeOwner: dispose,
  }));
  registerCardViews(fixture.view.registry);
  try {
    fixture.port.setState(stored(lead));
    context.bindView(fixture.view);
    const card = [...fixture.view.mirror.values()].find(
      (node) => node.type === 'document-card'
    );
    if (!card) throw new Error('Missing actual native card');
    action(context.host, String(card.key));
    return withoutIds(fixture.view.query.serializedState());
  } finally {
    context.dispose();
    context.disposeOwner();
    fixture.close();
  }
}

// DatabaseCard.tsx onToggle in an editable document converts the card to a
// mention; Source does it with $convertCardToMention. Only the stored document
// is compared: the selection selectEnd leaves is not asserted.
test('database card toggle stores what Source stores', () => {
  const expected = source((card) => {
    $convertCardToMention(card).selectEnd();
  });
  expect(native((host, key) => host.convertToMention(key, true))).toEqual(
    expected
  );
});

// DatabaseCard.tsx onLocationChange stores the new location as block params.
test('database card location change stores what Source stores', () => {
  const params = { view: 'board', group: 'status' };
  const expected = source((card) => card.setBlockParams(params));
  expect(native((host, key) => host.setBlockParams(key, params))).toEqual(
    expected
  );
});

// Controls: the comparison tells an action that did nothing, or stored other
// params, apart from the Source result.
test('the comparison rejects a native result that differs from Source', () => {
  const converted = source((card) => {
    $convertCardToMention(card).selectEnd();
  });
  expect(native(() => {})).not.toEqual(converted);
  const moved = source((card) => card.setBlockParams({ view: 'board' }));
  expect(
    native((host, key) => host.setBlockParams(key, { view: 'calendar' }))
  ).not.toEqual(moved);
});

// Node state other than the session id stays compared. Both engines drop a
// card's own node state (DocumentCardNode.exportJSON does not write it), so
// the state rides on the paragraph beside the card.
const STATEFUL = { ...PARAGRAPH, $: { probe: 'kept' } };

test.each([
  [
    'toggle',
    (host: NativeCardHost, key: string) => host.convertToMention(key, true),
    (card: DocumentCardNode) => {
      $convertCardToMention(card).selectEnd();
    },
  ],
  [
    'location change',
    (host: NativeCardHost, key: string) =>
      host.setBlockParams(key, { view: 'board' }),
    (card: DocumentCardNode) => card.setBlockParams({ view: 'board' }),
  ],
] as const)(
  'database card %s keeps sibling node state as Source does',
  (_, onNative, onSource) => {
    expect(native(onNative, STATEFUL)).toEqual(source(onSource, STATEFUL));
  }
);

// Control: a node state slot one engine lacks fails the comparison.
test('the comparison rejects a node state difference', () => {
  const params = { view: 'board' };
  expect(
    native((host, key) => host.setBlockParams(key, params), STATEFUL)
  ).not.toEqual(source((card) => card.setBlockParams(params)));
});
