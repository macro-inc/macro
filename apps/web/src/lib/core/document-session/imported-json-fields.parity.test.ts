/** @vitest-environment jsdom */
/**
 * Serialized fields of nodes imported from JSON that omits optional fields.
 * Pristine Lexical 0.45 (dist/Lexical.dev.mjs sha256 449d061d…) restores no
 * defaults: TextNode.updateFromJSON stores format/detail/mode/style as given
 * and exportJSON emits them as stored, so omitted ones stay omitted; Element
 * direction/indent likewise; ParagraphNode backfills textFormat/textStyle from
 * its first text child (undefined here) or its own defaults (0/'' when empty).
 * Native must serialize exactly what Source does, after import and after an
 * edit that splits the imported text (created nodes carry every field).
 *
 * Scope: node fields. Native's `$` NodeState (Macro node ids and the root's
 * documentMetadata) has no Source counterpart in this plugin-free editor; it
 * is dropped from the comparison and asserted separately to hold nothing else.
 */
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { locks } from 'node:worker_threads';
import * as native from '@core/document-session/wasm/document_session_wasm.js';
import { registerRichText } from '@lexical/rich-text';
import {
  ABI_MAJOR,
  CommandCode,
} from '@macro-inc/collaboration/session/abi.generated';
import { NodeReplacements, SupportedNodeTypes } from '@macro-inc/lexical-core';
import {
  createBuiltinRegistry,
  mountLocalSessionView,
  registerMacroElementViews,
} from '@macro-inc/lexical-wasm-view';
import { NOOP_SPAN } from '@macro-inc/observability';
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  createEditor,
} from 'lexical';
import { afterAll, beforeAll, expect, test } from 'vitest';

const previousLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
beforeAll(() => {
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: locks,
  });
  native.initSync({
    module: readFileSync(
      resolve(import.meta.dirname, 'wasm/document_session_wasm_bg.wasm')
    ),
  });
});
afterAll(() => {
  if (previousLocks) Object.defineProperty(navigator, 'locks', previousLocks);
  else Reflect.deleteProperty(navigator, 'locks');
});

/** Every optional TextNode and ParagraphNode field omitted. */
const INPUT = JSON.stringify({
  root: {
    type: 'root',
    version: 1,
    children: [
      {
        type: 'paragraph',
        version: 1,
        children: [{ type: 'text', version: 1, text: 'Before. After.' }],
      },
      { type: 'paragraph', version: 1, children: [] },
    ],
  },
});
/** "After." (offsets 8..14 of the first text) is bolded in the split case. */
const SPLIT = { from: 8, to: 14 };

/** Drop the `$` NodeState key everywhere (see the header's scope note). */
function withoutNodeState(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutNodeState);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== '$')
      .map(([key, child]) => [key, withoutNodeState(child)])
  );
}
/** Every `$` object's own keys, so the dropped NodeState is accounted for. */
function nodeStateKeys(value: unknown, found: string[][] = []): string[][] {
  if (Array.isArray(value)) {
    for (const child of value) nodeStateKeys(child, found);
    return found;
  }
  if (!value || typeof value !== 'object') return found;
  for (const [key, child] of Object.entries(value)) {
    if (key === '$' && child && typeof child === 'object')
      found.push(Object.keys(child).sort());
    else nodeStateKeys(child, found);
  }
  return found;
}

function source(split: boolean) {
  const editor = createEditor({
    namespace: 'imported-json-fields-source',
    nodes: [...SupportedNodeTypes, ...NodeReplacements],
    onError(error) {
      throw error;
    },
  });
  const release = registerRichText(editor);
  try {
    editor.setEditorState(editor.parseEditorState(INPUT));
    if (split)
      editor.update(
        () => {
          const text = $getRoot().getFirstDescendant();
          if (!$isTextNode(text)) throw new Error('Missing Source text');
          text.select(SPLIT.from, SPLIT.to);
          const selection = $getSelection();
          if (!$isRangeSelection(selection))
            throw new Error('Missing Source range');
          selection.formatText('bold');
        },
        { discrete: true }
      );
    return editor.getEditorState().toJSON();
  } finally {
    release();
  }
}

async function nativeState(split: boolean) {
  const root = document.createElement('div');
  document.body.append(root);
  const runtime = mountLocalSessionView(
    root,
    registerMacroElementViews(createBuiltinRegistry()),
    {
      namespace: 'imported-json-fields-native',
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
          'imported-json-fields-native'
        ),
    }
  );
  try {
    runtime.port.setState(INPUT);
    if (split) {
      const text = [...runtime.view.mirror.values()].find(
        (node) => node.kind === 'text'
      );
      if (!text) throw new Error('Missing native text');
      runtime.port.selectionFromView({
        kind: 'range',
        anchor: { key: text.key, offset: SPLIT.from, type: 'text' },
        focus: { key: text.key, offset: SPLIT.to, type: 'text' },
      });
      // FORMAT_TEXT_COMMAND 'bold' (format index 0), as native-mention-search.
      runtime.port.command(CommandCode.FormatText, 0);
    }
    const json: unknown = JSON.parse(runtime.view.query.serializedState());
    return json;
  } finally {
    await runtime.close();
    root.remove();
  }
}

test('Source keeps omitted fields omitted after JSON import', () => {
  expect(source(false).root.children).toEqual([
    {
      children: [{ text: 'Before. After.', type: 'text', version: 1 }],
      format: '',
      type: 'paragraph',
      version: 1,
    },
    {
      children: [],
      format: '',
      type: 'paragraph',
      version: 1,
      textFormat: 0,
      textStyle: '',
    },
  ]);
});

test('native serializes JSON-imported nodes exactly as Source', async () => {
  const actual = await nativeState(false);
  expect(nodeStateKeys(actual)).toEqual([
    ['id'],
    ['id'],
    ['id'],
    ['documentMetadata'],
  ]);
  expect(withoutNodeState(actual)).toEqual(source(false));
});

test('native serializes a split of JSON-imported text exactly as Source', async () => {
  const actual = await nativeState(true);
  expect(withoutNodeState(actual)).toEqual(source(true));
});
