import { $getRoot, $isElementNode } from 'lexical';
import { describe, expect, it } from 'vitest';
import { $getId } from '../../plugins/nodeIdPlugin';
import { $allById, $blockById, $byId, $getText } from './locate';
import { edit, read, setup } from './_test-helpers';

// ============================================================================
describe('lock-on + errors', () => {
  it('$byId resolves an existing node', () => {
    const { s, ids } = setup('hello');
    edit(s, () => {
      expect($getId($byId(s, ids[0]))).toBe(ids[0]);
    });
  });

  it('$byId throws EditError on a missing id', () => {
    const { s } = setup('hello');
    edit(s, () => {
      expect(() => $byId(s, 'nope-missing')).toThrowError(Error);
    });
  });

  it('$blockById throws EditError on a missing id', () => {
    const { s } = setup('hello');
    edit(s, () => {
      expect(() => $blockById(s, 'nope-missing')).toThrowError(Error);
    });
  });

  it('$blockById resolves an inline (text) id up to its containing block', () => {
    const { s } = setup('hello world');
    // the text node's id (a child of the block)
    const textId = read(s, () => {
      const block = $getRoot().getFirstChild();
      const text = $isElementNode(block) ? block.getFirstChild() : null;
      return text ? $getId(text) : null;
    });
    expect(textId).toBeTruthy();
    edit(s, () => {
      const block = $blockById(s, textId!);
      expect($isElementNode(block)).toBe(true);
      expect(block.getType()).toBe('paragraph');
    });
  });

  it('$allById resolves several, and throws EditError if any is missing', () => {
    const { s, ids } = setup('a\n\nb');
    edit(s, () => {
      const nodes = $allById(s, ids);
      expect(nodes).toHaveLength(2);
      expect(nodes.map((n) => $getId(n))).toEqual(ids);
      expect(() => $allById(s, [ids[0], 'missing'])).toThrowError(Error);
    });
  });
});

// ============================================================================
describe('read / query', () => {
  it('$getText returns a block plain text (no markdown markers)', () => {
    const { s, ids } = setup('the **bold** word');
    expect(read(s, () => $getText($blockById(s, ids[0])))).toBe('the bold word');
  });
});
