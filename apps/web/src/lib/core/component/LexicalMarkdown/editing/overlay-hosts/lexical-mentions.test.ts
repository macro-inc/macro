import { InlineSearchNode } from '@macro-inc/lexical-core';
import {
  $createParagraphNode,
  $getRoot,
  $nodesOfType,
  type LexicalEditor,
} from 'lexical';
import { expect, test } from 'vitest';
import { behaviorEditor } from '../../behavior-inventory/editor';
import { mentionsPlugin } from '../../plugins/mentions/mentionsPlugin';
import { createMenuOperations } from '../../shared/inlineMenu';
import { createLexicalMentionMenuHost } from './lexical-mentions';

test('Source root and close recover when an editor appears without adopting a new selection handler', () => {
  let current: LexicalEditor | undefined;
  const host = createLexicalMentionMenuHost(() => current, undefined);
  expect(host.root()).toBeNull();
  host.closeSearch();
  const menu = createMenuOperations();
  const { editor, root } = behaviorEditor(mentionsPlugin({ menu }));
  current = editor;
  expect(host.root()).toBe(root);
  editor.update(() => $getRoot().append($createParagraphNode()).selectEnd(), {
    discrete: true,
  });
  root.dispatchEvent(new KeyboardEvent('keydown', { key: '@' }));
  editor.read(() => expect($nodesOfType(InlineSearchNode)).toHaveLength(1));
  expect(
    host.select({
      kind: 'group',
      id: 'here',
      data: { id: 'here', groupAlias: 'here' },
    })
  ).toBeUndefined();
  editor.read(() => expect($nodesOfType(InlineSearchNode)).toHaveLength(1));
  host.closeSearch();
  editor.read(() => {
    expect($nodesOfType(InlineSearchNode)).toHaveLength(0);
    expect($getRoot().getTextContent()).toBe('@');
  });
});
