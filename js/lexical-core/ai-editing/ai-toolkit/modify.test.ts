import { $isListItemNode } from '@lexical/list';
import { $getRoot } from 'lexical';
import { describe, expect, it } from 'vitest';
import { $getId } from '../../plugins/nodeIdPlugin';
import { $byId } from './locate';
import { $modifyNode } from './modify';
import { createEditingSession, loadMarkdown } from './session';
import { removeLinePrefix, edit, read, setup } from './_test-helpers';

// ============================================================================
describe('$modifyNode', () => {
  it("op 'blockType' changes type + level, keeping the id", () => {
    const { s, ids } = setup('Notes');
    edit(s, () => $modifyNode(s, ids[0], { op: 'blockType', block: 'heading', level: 2 }));
    expect(removeLinePrefix(s)).toBe(`## Notes {${ids[0]}|heading}`);
  });

  it("op 'text' rewrites a block's content, keeping type + id", () => {
    const { s, ids } = setup('# Title');
    edit(s, () => $modifyNode(s, ids[0], { op: 'text', text: 'New title' }));
    expect(removeLinePrefix(s)).toBe(`# New title {${ids[0]}|heading}`);
  });

  it("op 'listType' retypes the enclosing list from any item, preserving nesting", () => {
    const s = createEditingSession();
    loadMarkdown(s, '- a\n  - b');
    const bId = read(s, () => {
      let t: any;
      const walk = (n: any) => {
        if ($isListItemNode(n) && n.getTextContent() === 'b') t = n;
        n.getChildren?.().forEach(walk);
      };
      $getRoot().getChildren().forEach(walk);
      return $getId(t);
    });
    edit(s, () => $modifyNode(s, bId!, { op: 'listType', list: 'number' }));
    read(s, () => {
      const item = $byId(s, bId!) as any;
      expect(item.getIndent()).toBe(1);
      expect((item.getParent() as any).getListType()).toBe('number');
    });
  });

  it("op 'checked' checks an item (in a check list)", () => {
    const { s } = setup('- a\n- b');
    const aId = read(s, () => $getId(($getRoot().getFirstChild() as any).getChildren()[0]));
    // getChecked() only reflects a value inside a check list
    edit(s, () => $modifyNode(s, aId!, { op: 'listType', list: 'check' }));
    edit(s, () => $modifyNode(s, aId!, { op: 'checked', checked: true }));
    expect(read(s, () => ($byId(s, aId!) as any).getChecked())).toBe(true);
  });

  it("op 'indent' nests / un-nests a list item", () => {
    const { s } = setup('- a\n- b');
    const bId = read(s, () => $getId(($getRoot().getFirstChild() as any).getChildren()[1]));
    edit(s, () => $modifyNode(s, bId!, { op: 'indent', indent: 'in' }));
    expect(read(s, () => ($byId(s, bId!) as any).getIndent())).toBe(1);
    edit(s, () => $modifyNode(s, bId!, { op: 'indent', indent: 'out' }));
    expect(read(s, () => ($byId(s, bId!) as any).getIndent())).toBe(0);
  });

  it("op 'checked' on a non-list-item throws EditError", () => {
    const { s, ids } = setup('plain paragraph');
    edit(s, () => {
      expect(() => $modifyNode(s, ids[0], { op: 'checked', checked: true })).toThrowError(
        Error
      );
    });
  });

  it('accepts a node directly (composes with $byId)', () => {
    const { s, ids } = setup('# Frogs\n\nframe budget\n\nthe frog line');
    edit(s, () => {
      const node = $byId(s, ids[2]);
      $modifyNode(s, node, { op: 'blockType', block: 'quote' });
    });
    expect(removeLinePrefix(s)).toContain('> the frog line');
  });
});
