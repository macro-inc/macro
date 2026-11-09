import { registerRichText } from '@lexical/rich-text';
import {
  $createClassedBlockNode,
  NodeReplacements,
  SupportedNodeTypes,
} from '@macro-inc/lexical-core';
import {
  $createParagraphNode,
  $createTabNode,
  $createTextNode,
  $getRoot,
  COPY_COMMAND,
  createEditor,
  PASTE_COMMAND,
} from 'lexical';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import syntheticNodes from '../../../../../../../../crates/client/lexical/macro_document_model/tests/corpus/nodes.jsonl?raw';
import { theme } from '../theme';

vi.mock('@core/internal/BlockLoader', () => ({}));
class FixtureClipboardEvent extends Event {}
class FixtureDragEvent extends Event {}
const cleanups: (() => void)[] = [];
beforeEach(() => {
  vi.stubGlobal('ClipboardEvent', FixtureClipboardEvent);
  vi.stubGlobal('DragEvent', FixtureDragEvent);
  vi.spyOn(Date, 'now').mockReturnValue(1767225600000);
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function macroEditor() {
  const editor = createEditor({
    namespace: 'html-paste-source',
    nodes: [...SupportedNodeTypes, ...NodeReplacements],
    theme,
    onError(error) {
      throw error;
    },
  });
  const root = document.createElement('div');
  root.contentEditable = 'true';
  document.body.append(root);
  editor.setRootElement(root);
  const dispose = registerRichText(editor);
  cleanups.push(() => {
    dispose();
    editor.setRootElement(null);
    root.remove();
  });
  return editor;
}

const row = z.object({
  name: z.string(),
  type: z.string(),
  json: z.string().optional(),
  error: z.string().optional(),
});
const fixtures = syntheticNodes
  .trim()
  .split('\n')
  .map((line) => {
    const decoded: unknown = JSON.parse(line);
    return row.parse(decoded);
  })
  .filter(
    (entry) =>
      entry.name === `${entry.type}:full:export` &&
      entry.json !== undefined &&
      entry.type !== 'classed-block'
  );
const covered = new Set([
  ...fixtures.map((entry) => entry.type),
  'tab',
  'classed-block',
]);
it('covers every configured Macro node with an exported source fixture or valid factory', () => {
  expect(
    SupportedNodeTypes.map((node) => node.getType()).filter(
      (name) => !covered.has(name)
    )
  ).toEqual([]);
});

it.each([
  ...fixtures,
  { name: 'valid classed-block', type: 'classed-block', json: undefined },
  { name: 'authored tab', type: 'tab', json: undefined },
])('actual OFF HTML paste of exported $name', ({ type, json }) => {
  const source = macroEditor();
  if (json !== undefined) source.setEditorState(source.parseEditorState(json));
  source.update(
    () => {
      if (json === undefined) {
        const node =
          type === 'tab'
            ? $createParagraphNode().append($createTabNode())
            : $createClassedBlockNode({
                tag: 'div',
                classes: ['fixture-block'],
              }).append($createTextNode('classed'));
        $getRoot().append(node);
      }
      $getRoot().select(0, $getRoot().getChildrenSize());
    },
    { discrete: true }
  );
  const exported: Record<string, string> = {};
  const copy = new ClipboardEvent('copy', { cancelable: true });
  Object.defineProperty(copy, 'clipboardData', {
    value: {
      setData(mime: string, value: string) {
        exported[mime] = value;
      },
    },
  });
  source.update(
    () => {
      expect(source.dispatchCommand(COPY_COMMAND, copy)).toBe(true);
    },
    { discrete: true }
  );
  const target = macroEditor();
  target.update(
    () => {
      const paragraph = $createParagraphNode();
      $getRoot().append(paragraph);
      paragraph.selectStart();
    },
    { discrete: true }
  );
  const html = exported['text/html'] ?? '';
  const plain = exported['text/plain'] ?? '';
  const paste = new ClipboardEvent('paste', { cancelable: true });
  Object.defineProperty(paste, 'clipboardData', {
    value: {
      getData(mime: string) {
        return mime === 'text/html' ? html : mime === 'text/plain' ? plain : '';
      },
      types: ['text/html', 'text/plain'],
      files: [],
      items: [],
    },
  });
  let handled = false;
  target.update(
    () => {
      handled = target.dispatchCommand(PASTE_COMMAND, paste);
    },
    { discrete: true }
  );
  target.read(() => {});
  expect({
    html,
    plain,
    handled,
    prevented: paste.defaultPrevented,
    model: target.getEditorState().toJSON(),
  }).toMatchSnapshot();
});
