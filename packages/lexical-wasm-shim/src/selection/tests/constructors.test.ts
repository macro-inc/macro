import { describe, expect, test } from 'vitest';
import {
  $createNodeSelection,
  $createPoint,
  $createRangeSelection,
  $isNodeSelection,
  $isRangeSelection,
  NodeSelection,
  Point,
  RangeSelection,
  tokenizeRawText,
} from '../index';

describe('pinned JS selection construction', () => {
  test('keeps the upstream owner-less Point fields and development descriptor', () => {
    const point = $createPoint('root', 0, 'element');
    expect(point).toBeInstanceOf(Point);
    expect(point._selection).toBeNull();
    expect(Object.keys(point)).toEqual(['key', 'offset', 'type']);
    expect(Object.getOwnPropertyDescriptor(point, '_selection')).toEqual({
      value: null,
      enumerable: false,
      writable: true,
      configurable: false,
    });
    expect(point.is($createPoint('root', 0, 'element'))).toBe(true);
    expect(point.is($createPoint('root', 0, 'text'))).toBe(false);
  });

  test('attaches both points to the actual RangeSelection without a native reference', () => {
    const selection = $createRangeSelection();
    expect(selection).toBeInstanceOf(RangeSelection);
    expect(selection.anchor).not.toBe(selection.focus);
    expect(selection.anchor._selection).toBe(selection);
    expect(selection.focus._selection).toBe(selection);
    expect(selection.anchor.key).toBe('root');
    expect(selection.anchor.offset).toBe(0);
    expect(selection.anchor.type).toBe('element');
    expect(selection.isCollapsed()).toBe(true);
    expect(selection.isBackward()).toBe(false);
    expect(selection.format).toBe(0);
    expect(selection.style).toBe('');
    expect(selection.dirty).toBe(false);
    expect(selection._cachedIsBackward).toBe(false);
    expect(selection.getCachedNodes()).toBeNull();
    expect(Object.keys(selection)).toEqual([
      'anchor',
      'focus',
      '_cachedNodes',
      '_cachedIsBackward',
      'format',
      'style',
      'dirty',
    ]);
  });

  test('clones point ownership and resets caches and dirty state', () => {
    const selection = new RangeSelection(
      $createPoint('left', 2, 'text'),
      $createPoint('right', 4, 'text'),
      3,
      'color: red;'
    );
    selection.dirty = true;
    selection._cachedNodes = [];
    selection._cachedIsBackward = true;
    const clone = selection.clone();
    expect(clone.is(selection)).toBe(true);
    expect(clone).not.toBe(selection);
    expect(clone.anchor).not.toBe(selection.anchor);
    expect(clone.focus).not.toBe(selection.focus);
    expect(clone.anchor._selection).toBe(clone);
    expect(selection.anchor._selection).toBe(selection);
    expect(clone.dirty).toBe(false);
    expect(clone._cachedNodes).toBeNull();
    expect(clone._cachedIsBackward).toBeNull();
  });

  test('preserves node-key Set order, invalidation and independent clones', () => {
    const selection = $createNodeSelection();
    expect(selection).toBeInstanceOf(NodeSelection);
    expect(selection.dirty).toBe(false);
    selection.add('b');
    selection.add('a');
    selection.add('b');
    selection.setCachedNodes([]);
    const clone = selection.clone();
    expect(Array.from(clone._nodes)).toEqual(['b', 'a']);
    expect(clone.is(selection)).toBe(true);
    expect(clone._nodes).not.toBe(selection._nodes);
    expect(clone.dirty).toBe(false);
    expect(clone.getCachedNodes()).toBeNull();
    selection.delete('missing');
    expect(selection.getCachedNodes()).toBeNull();
    selection.clear();
    expect(selection.has('a')).toBe(false);
    expect(clone.has('a')).toBe(true);
    expect(selection.isCollapsed()).toBe(false);
    expect(selection.getStartEndPoints()).toBeNull();
    expect($isNodeSelection(selection)).toBe(true);
    expect($isRangeSelection(selection)).toBe(false);
  });

  test('reads empty node selections without requiring a model scope', () => {
    const selection = $createNodeSelection();
    const nodes = selection.getNodes();
    expect(nodes).toEqual([]);
    expect(selection.getNodes()).toBe(nodes);
    expect(selection.getTextContent()).toBe('');
  });

  test('keeps mutually exclusive text formats and marks style changes dirty', () => {
    const selection = $createRangeSelection();
    selection.toggleFormat('subscript');
    selection.toggleFormat('superscript');
    expect(selection.hasFormat('subscript')).toBe(false);
    expect(selection.hasFormat('superscript')).toBe(true);
    selection.toggleFormat('lowercase');
    selection.toggleFormat('uppercase');
    selection.toggleFormat('capitalize');
    expect(selection.hasFormat('lowercase')).toBe(false);
    expect(selection.hasFormat('uppercase')).toBe(false);
    expect(selection.hasFormat('capitalize')).toBe(true);
    selection.setStyle('font-size: 15px;');
    expect(selection.style).toBe('font-size: 15px;');
    expect(selection.dirty).toBe(true);
  });

  test('tokenizes raw text without breaking surrogate or combining sequences', () => {
    const tokens: string[] = [];
    tokenizeRawText('😀e\u0301\r\n\t\n尾\r', {
      text: (text) => tokens.push(text),
      linebreak: () => tokens.push('<line>'),
      tab: () => tokens.push('<tab>'),
    });
    expect(tokens).toEqual(['😀e\u0301', '<line>', '<tab>', '<line>', '尾\r']);
  });
});
