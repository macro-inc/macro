import { $getId } from '@macro-inc/lexical-core/plugins/nodeIdPlugin';
import { $getRoot, $isElementNode } from 'lexical';
import { describe, expect, it } from 'vitest';
import { edit, read, setup } from './_test-helpers';
import { $blockById, $byId } from './locate';

describe('lock-on + errors', () => {
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
});
