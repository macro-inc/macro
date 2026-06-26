import {
  $isListItemNode,
  $isListNode,
  type ListItemNode,
  type ListNode,
} from '@lexical/list';
import { $getRoot, $isElementNode, type LexicalNode } from 'lexical';
import { describe, expect, it } from 'vitest';
import { $getId } from '../../../../lexical-core/plugins/nodeIdPlugin';
import { serializeWithXml } from '../utils';
import { edit, read, setup, topLevelIds } from './_test-helpers';
import { $setListType, $toggleList } from './lists';
import { $byId } from './locate';
import { createEditingSession, loadMarkdown, type LexicalSession } from './session';

describe('deferred: lists', () => {
  it('$toggleList creates one list block (fresh id); items get fresh ids', () => {
    const { session, ids } = setup('todo a\n\ntodo b');
    const list = edit(session, () =>
      $toggleList(
        ids.map((id) => $byId(session, id)),
        'check'
      )
    );
    // single top-level block now
    const top = topLevelIds(session);
    expect(top).toHaveLength(1);
    const listId = read(session, () => $getId(list));
    expect(listId).toBe(top[0]);
    expect(ids).not.toContain(listId); // fresh list id

    const items = read(session, () => {
      const ln = $getRoot().getFirstChild() as ListNode;
      expect($isListNode(ln)).toBe(true);
      return (ln.getChildren() as ListItemNode[]).map((it) => ({
        id: $getId(it),
        text: it.getTextContent(),
        checked: it.getChecked(),
      }));
    });
    expect(items.map((i: any) => i.text)).toEqual(['todo a', 'todo b']);
    // check list => items default unchecked
    expect(items.every((i: any) => i.checked === false)).toBe(true);
    // item ids are fresh, present, and distinct
    const itemIds = items.map((i: any) => i.id);
    expect(new Set(itemIds).size).toBe(2);
    for (const iid of itemIds) {
      expect(iid).toBeTruthy();
      expect(ids).not.toContain(iid);
    }
    // serialized as a checklist, each item carrying its own id in XML
    const xml = serializeWithXml(session);
    expect(xml).toContain('<ul');
    expect(xml).toContain(`id="${itemIds[0]}"`);
    expect(xml).toContain(`id="${itemIds[1]}"`);
    expect(xml).toContain('todo a');
    expect(xml).toContain('todo b');
  });
});

describe('$setListType / $toggleList separation', () => {
  // find the deepest list item with the given text
  const deepItemId = (session: LexicalSession, text: string) =>
    read(session, () => {
      let target: ListItemNode | undefined;
      const walk = (n: LexicalNode) => {
        if ($isListItemNode(n) && n.getTextContent() === text) target = n;
        if ($isElementNode(n)) n.getChildren().forEach(walk);
      };
      $getRoot().getChildren().forEach(walk);
      return target ? $getId(target) : null;
    });

  it('$setListType retypes a NESTED list, preserving indent + the item id (list id is fresh)', () => {
    const session = createEditingSession();
    loadMarkdown(session, '- deeply\n  - nested\n    - list\n      - items');
    const itemId = deepItemId(session, 'items');
    edit(session, () =>
      $setListType($byId(session, itemId!), 'number', session)
    );
    read(session, () => {
      // the item is carried over by replace(…, true): its id still resolves
      const item = $byId(session, itemId!) as ListItemNode;
      expect(item.getType()).toBe('listitem');
      expect(item.getIndent()).toBe(3); // still deeply nested, not hoisted
      expect($isListNode(item.getParent())).toBe(true);
      expect((item.getParent() as ListNode).getListType()).toBe('number');
      expect($getRoot().getChildren()).toHaveLength(1);
    });
  });
});
