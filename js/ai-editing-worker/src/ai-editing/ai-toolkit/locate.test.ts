import { $getRoot, $isElementNode } from 'lexical';
import { describe, expect, it } from 'vitest';
import { $getId } from '../../../../lexical-core/plugins/nodeIdPlugin';
import { edit, read, setup } from './_test-helpers';
import { $allById, $blockById, $byId, $getText } from './locate';

describe('lock-on + errors', () => {
  it('$byId resolves an existing node', () => {
    const { session, ids } = setup('hello');
    edit(session, () => {
      expect($getId($byId(session, ids[0]))).toBe(ids[0]);
    });
  });

  it('$byId throws EditError on a missing id', () => {
    const { session } = setup('hello');
    edit(session, () => {
      expect(() => $byId(session, 'nope-missing')).toThrowError(Error);
    });
  });

  it('$blockById throws EditError on a missing id', () => {
    const { session } = setup('hello');
    edit(session, () => {
      expect(() => $blockById(session, 'nope-missing')).toThrowError(Error);
    });
  });

  it('$blockById resolves an inline (text) id up to its containing block', () => {
    const { session } = setup('hello world');
    // the text node's id (a child of the block)
    const textId = read(session, () => {
      const block = $getRoot().getFirstChild();
      const text = $isElementNode(block) ? block.getFirstChild() : null;
      return text ? $getId(text) : null;
    });
    expect(textId).toBeTruthy();
    edit(session, () => {
      const block = $blockById(session, textId!);
      expect($isElementNode(block)).toBe(true);
      expect(block.getType()).toBe('paragraph');
    });
  });

  it('$allById resolves several, and throws EditError if any is missing', () => {
    const { session, ids } = setup('a\n\nb');
    edit(session, () => {
      const nodes = $allById(session, ids);
      expect(nodes).toHaveLength(2);
      expect(nodes.map((n) => $getId(n))).toEqual(ids);
      expect(() => $allById(session, [ids[0], 'missing'])).toThrowError(Error);
    });
  });
});

describe('read / query', () => {
  it('$getText returns a block plain text (no markdown markers)', () => {
    const { session, ids } = setup('the **bold** word');
    expect(read(session, () => $getText($blockById(session, ids[0])))).toBe(
      'the bold word'
    );
  });
});
