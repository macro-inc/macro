import { $getRoot } from 'lexical';
import { $isListItemNode, $isListNode, type ListItemNode } from '@lexical/list';
import { describe, expect, it } from 'vitest';
import { $getId } from '../../plugins/nodeIdPlugin';
import { serializeWithIds } from '../utils';
import {
  $indent,
  $outdent,
  $setChecked,
  $setListType,
  $sortList,
  $toggleList,
} from './lists';
import { $allById, $blockById, $byId } from './locate';
import { createEditingSession, loadMarkdown, type Session } from './session';
import { edit, read, setup, topLevelIds } from './_test-helpers';

// ============================================================================
describe('deferred: lists', () => {
  it('$toggleList creates one list block (fresh id); items get fresh ids', () => {
    const { s, ids } = setup('todo a\n\ntodo b');
    const list = edit(s, () => $toggleList($allById(s, ids), 'check'));
    // single top-level block now
    const top = topLevelIds(s);
    expect(top).toHaveLength(1);
    const listId = read(s, () => $getId(list));
    expect(listId).toBe(top[0]);
    expect(ids).not.toContain(listId); // fresh list id

    const items = read(s, () => {
      const ln = $getRoot().getFirstChild()!;
      expect($isListNode(ln)).toBe(true);
      return (ln as any).getChildren().map((it: ListItemNode) => ({
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
    // serialized as a checklist, each item carrying its own id
    expect(serializeWithIds(s)).toBe(
      `1 | - [ ] todo a {${itemIds[0]}|listitem}\n2 | - [ ] todo b {${itemIds[1]}|listitem}`
    );
  });

  it('$setChecked checks a list item', () => {
    const { s, ids } = setup('todo a\n\ntodo b');
    edit(s, () => $toggleList($allById(s, ids), 'check'));
    const firstItemId = read(s, () => {
      const ln = $getRoot().getFirstChild()! as any;
      return $getId(ln.getFirstChild());
    });
    edit(s, () => $setChecked($byId(s, firstItemId!), true));
    const checked = read(s, () => {
      const ln = $getRoot().getFirstChild()! as any;
      return ln.getChildren().map((it: ListItemNode) => it.getChecked());
    });
    expect(checked).toEqual([true, false]);
  });

  it('$setChecked throws EditError on a non-list-item', () => {
    const { s, ids } = setup('plain paragraph');
    edit(s, () => {
      expect(() => $setChecked($blockById(s, ids[0]), true)).toThrowError(
        Error
      );
    });
  });

  it('$indent nests a list item one level deeper (assert via getIndent)', () => {
    const { s, ids } = setup('- parent\n- child');
    const childId = read(s, () => {
      const ln = $getRoot().getFirstChild()! as any;
      return $getId(ln.getChildren()[1]);
    });
    edit(s, () => $indent($byId(s, childId!)));
    const indent = read(s, () => ($byId(s, childId!) as any).getIndent());
    expect(indent).toBe(1);
  });

  it('$outdent un-nests a list item one level', () => {
    const { s, ids } = setup('- parent\n- child');
    const childId = read(s, () => {
      const ln = $getRoot().getFirstChild()! as any;
      return $getId(ln.getChildren()[1]);
    });
    edit(s, () => $indent($byId(s, childId!)));
    expect(read(s, () => ($byId(s, childId!) as any).getIndent())).toBe(1);
    edit(s, () => $outdent($byId(s, childId!)));
    expect(read(s, () => ($byId(s, childId!) as any).getIndent())).toBe(0);
  });

  it('$indent / $outdent throw EditError on a non-list-item', () => {
    const { s, ids } = setup('plain paragraph');
    edit(s, () => {
      expect(() => $indent($blockById(s, ids[0]))).toThrowError(Error);
      expect(() => $outdent($blockById(s, ids[0]))).toThrowError(Error);
    });
  });
});

// ============================================================================
describe('$setListType / $toggleList separation', () => {
  // find the deepest list item with the given text
  const deepItemId = (s: Session, text: string) =>
    read(s, () => {
      let target: any;
      const walk = (n: any) => {
        if ($isListItemNode(n) && n.getTextContent() === text) target = n;
        n.getChildren?.().forEach(walk);
      };
      $getRoot().getChildren().forEach(walk);
      return $getId(target);
    });

  it('$setListType retypes a NESTED list in place, preserving indent + id', () => {
    const s = createEditingSession();
    loadMarkdown(s, '- deeply\n  - nested\n    - list\n      - items');
    const itemId = deepItemId(s, 'items');
    edit(s, () => $setListType($byId(s, itemId!), 'number'));
    read(s, () => {
      const item = $byId(s, itemId!) as any; // id preserved
      expect(item.getType()).toBe('listitem');
      expect(item.getIndent()).toBe(3); // still deeply nested, not hoisted
      expect($isListNode(item.getParent())).toBe(true);
      expect((item.getParent() as any).getListType()).toBe('number');
      expect($getRoot().getChildren()).toHaveLength(1);
    });
  });

  it('$toggleList refuses an existing list item (points to $setListType)', () => {
    const { s } = setup('- a\n- b');
    const itemId = read(s, () => $getId(($getRoot().getFirstChild() as any).getChildren()[0]));
    edit(s, () => {
      expect(() => $toggleList([$byId(s, itemId!)], 'number')).toThrowError(Error);
    });
  });
});

// ============================================================================
describe('$sortList', () => {
  const itemTexts = (s: Session) =>
    read(s, () =>
      ($getRoot().getFirstChild() as any).getChildren().map((i: any) => i.getTextContent())
    );

  it('sorts the enclosing list ascending (resolving from any item)', () => {
    const { s } = setup('- banana\n- apple\n- cherry');
    const itemId = read(s, () => $getId(($getRoot().getFirstChild() as any).getChildren()[0]));
    edit(s, () => $sortList($byId(s, itemId!)));
    expect(itemTexts(s)).toEqual(['apple', 'banana', 'cherry']);
  });

  it('supports descending order and accepts the list node directly', () => {
    const { s } = setup('- apple\n- banana\n- cherry');
    edit(s, () => $sortList($getRoot().getFirstChild()!, { order: 'desc' }));
    expect(itemTexts(s)).toEqual(['cherry', 'banana', 'apple']);
  });

  it('throws EditError when there is no enclosing list', () => {
    const { s, ids } = setup('just a paragraph');
    edit(s, () => {
      expect(() => $sortList($blockById(s, ids[0]))).toThrowError(Error);
    });
  });
});
