import { $createSnapshotNode } from '@macro-inc/lexical-core';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_NORMAL,
  KEY_ENTER_COMMAND,
} from 'lexical';
import { createRoot } from 'solid-js';
import { afterEach, expect, test } from 'vitest';
import { createLexicalWrapper } from '../../context/LexicalWrapperContext';
import { theme } from '../../theme';
import { createLexicalSnapshotHost } from '../lexical-snapshot';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});
function setup() {
  return createRoot((dispose) => {
    const wrapper = createLexicalWrapper({
      type: 'markdown-sync',
      namespace: 'snapshot-host',
      withIds: true,
      theme,
      isInteractable: () => true,
    });
    cleanups.push(() => {
      wrapper.cleanup();
      dispose();
    });
    return { editor: wrapper.editor, host: createLexicalSnapshotHost(wrapper) };
  });
}
function snapshot() {
  return $createSnapshotNode({
    documentId: 'snapshot-document',
    documentName: 'Snapshot',
    blockName: 'md',
    content: 'Saved text',
    snapshotDate: '2020-01-01T00:00:00.000Z',
  });
}

test('Source snapshot host retains actual Normal registration order and cleanup', () => {
  const { editor, host } = setup();
  const seen: string[] = [];
  editor.registerCommand(
    KEY_ENTER_COMMAND,
    () => {
      seen.push('earlier');
      return false;
    },
    COMMAND_PRIORITY_NORMAL
  );
  const release = host.registerNormalEnter((event) => {
    expect(event).toBeNull();
    seen.push('host');
    return false;
  });
  editor.registerCommand(
    KEY_ENTER_COMMAND,
    () => {
      seen.push('later');
      return false;
    },
    COMMAND_PRIORITY_NORMAL
  );
  editor.dispatchCommand(KEY_ENTER_COMMAND, null);
  expect(seen).toEqual(['earlier', 'host', 'later']);
  release?.();
  seen.length = 0;
  editor.dispatchCommand(KEY_ENTER_COMMAND, null);
  expect(seen).toEqual(['earlier', 'later']);
});

test('Source snapshot removal retains its actual type predicate', () => {
  const { editor, host } = setup();
  editor.update(
    () => {
      const text = $createTextNode('Keep');
      $getRoot().append($createParagraphNode().append(text));
      host.remove(text.getKey());
      expect(text.isAttached()).toBe(true);
    },
    { discrete: true }
  );
  expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe(
    'Keep'
  );
});

for (const boundary of ['next', 'previous', 'empty-parent'] as const) {
  test(`Source snapshot removal restores ${boundary} selection`, () => {
    const { editor, host } = setup();
    editor.update(
      () => {
        const parent = $createParagraphNode();
        const target = snapshot();
        const text = $createTextNode('Keep');
        if (boundary === 'previous') parent.append(text, target);
        else if (boundary === 'next') parent.append(target, text);
        else parent.append(target);
        $getRoot().append(parent);
        host.remove(target.getKey());
        expect(target.isAttached()).toBe(false);
        const selection = $getSelection();
        if (!$isRangeSelection(selection))
          throw new Error('Missing restored Source range');
        expect(selection.anchor.key).toBe(
          boundary === 'empty-parent' ? parent.getKey() : text.getKey()
        );
        expect(selection.anchor.offset).toBe(boundary === 'previous' ? 4 : 0);
        expect(selection.isCollapsed()).toBe(true);
      },
      { discrete: true }
    );
  });
}
