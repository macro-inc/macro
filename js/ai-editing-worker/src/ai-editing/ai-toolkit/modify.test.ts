import {
  $isListItemNode,
  type ListItemNode,
  type ListNode,
} from '@lexical/list';
import { $getRoot, $isElementNode, type LexicalNode } from 'lexical';
import { describe, expect, it } from 'vitest';
import { $getId } from '../../../../lexical-core/plugins/nodeIdPlugin';
import { serializeWithXml } from '../utils';
import { edit, read, setup } from './_test-helpers';
import { $byId } from './locate';
import { $modifyNode } from './modify';
import { createEditingSession, loadMarkdown } from './session';

describe('$modifyNode', () => {
  it("op 'blockType' changes type + level, minting a fresh id the old id forwards to", () => {
    const { session, ids } = setup('Notes');
    const old = ids[0]!;
    edit(session, () =>
      $modifyNode(session, old, {
        op: 'blockType',
        block: { type: 'heading', level: 2 },
      })
    );
    const xml = serializeWithXml(session);
    expect(xml).toContain('<h2');
    expect(xml).toContain('Notes');
    // fresh id replaces the old one, but the old id still resolves to the node
    expect(xml).not.toContain(`id="${old}"`);
    expect(read(session, () => $getId($byId(session, old)))).not.toBe(old);
  });

  it("op 'text' rewrites a block's content, keeping type + id", () => {
    const { session, ids } = setup('# Title');
    edit(session, () =>
      $modifyNode(session, ids[0], { op: 'text', text: 'New title' })
    );
    const xml = serializeWithXml(session);
    expect(xml).toContain('<h1');
    expect(xml).toContain(`id="${ids[0]}"`);
    expect(xml).toContain('New title');
  });

  it("op 'listType' retypes the enclosing list from any item, preserving nesting", () => {
    const session = createEditingSession();
    loadMarkdown(session, '- a\n  - b');
    const bId = read(session, () => {
      let target: ListItemNode | undefined;
      const walk = (n: LexicalNode) => {
        if ($isListItemNode(n) && n.getTextContent() === 'b') target = n;
        if ($isElementNode(n)) n.getChildren().forEach(walk);
      };
      $getRoot().getChildren().forEach(walk);
      return target ? $getId(target) : null;
    });
    edit(session, () =>
      $modifyNode(session, bId!, { op: 'listType', list: 'number' })
    );
    read(session, () => {
      const item = $byId(session, bId!) as ListItemNode;
      expect(item.getIndent()).toBe(1);
      expect((item.getParent() as ListNode).getListType()).toBe('number');
    });
  });

  it("op 'checked' checks an item (in a check list)", () => {
    const { session } = setup('- a\n- b');
    const aId = read(session, () =>
      $getId(($getRoot().getFirstChild() as ListNode).getChildren()[0])
    );
    // getChecked() only reflects a value inside a check list
    edit(session, () =>
      $modifyNode(session, aId!, { op: 'listType', list: 'check' })
    );
    edit(session, () =>
      $modifyNode(session, aId!, { op: 'checked', checked: true })
    );
    expect(
      read(session, () => ($byId(session, aId!) as ListItemNode).getChecked())
    ).toBe(true);
  });

  it("op 'indent' nests / un-nests a list item", () => {
    const { session } = setup('- a\n- b');
    const bId = read(session, () =>
      $getId(($getRoot().getFirstChild() as ListNode).getChildren()[1])
    );
    edit(session, () =>
      $modifyNode(session, bId!, { op: 'indent', indent: 'in' })
    );
    expect(
      read(session, () => ($byId(session, bId!) as ListItemNode).getIndent())
    ).toBe(1);
    edit(session, () =>
      $modifyNode(session, bId!, { op: 'indent', indent: 'out' })
    );
    expect(
      read(session, () => ($byId(session, bId!) as ListItemNode).getIndent())
    ).toBe(0);
  });

  it("op 'checked' on a non-list-item throws EditError", () => {
    const { session, ids } = setup('plain paragraph');
    edit(session, () => {
      expect(() =>
        $modifyNode(session, ids[0], { op: 'checked', checked: true })
      ).toThrowError(Error);
    });
  });

  it('accepts a node directly (composes with $byId)', () => {
    const { session, ids } = setup('# Frogs\n\nframe budget\n\nthe frog line');
    edit(session, () => {
      const node = $byId(session, ids[2]);
      $modifyNode(session, node, { op: 'blockType', block: { type: 'quote' } });
    });
    const xml = serializeWithXml(session);
    expect(xml).toContain('the frog line');
    expect(xml).toContain('<blockquote');
  });
});
