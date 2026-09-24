import { describe, expect, it } from 'vitest';
import {
  createSplitRouterHistories,
  createSplitRouterHistory,
} from '../history';

describe('split router history', () => {
  it('pushes, replaces, and traverses entries', () => {
    const history = createSplitRouterHistory<string>('one', Object.is);

    expect(history.push('two')).toBe(true);
    expect(history.push('three')).toBe(true);
    expect(history.entries()).toEqual(['one', 'two', 'three']);
    expect(history.canGo(-2)).toBe(true);
    expect(history.go(-1)).toBe(true);
    expect(history.current()).toBe('two');
    expect(history.replace('second')).toBe(true);
    expect(history.entries()).toEqual(['one', 'second', 'three']);
    expect(history.go(1)).toBe(true);
    expect(history.current()).toBe('three');
  });

  it('truncates forward entries after a push', () => {
    const history = createSplitRouterHistory<string>('one', Object.is);

    history.push('two');
    history.push('three');
    history.go(-2);
    history.push('four');

    expect(history.entries()).toEqual(['one', 'four']);
    expect(history.canGo(1)).toBe(false);
  });

  it('accepts an existing entry by moving the index', () => {
    const history = createSplitRouterHistory<string>('one', Object.is);

    history.push('two');
    history.push('three');

    expect(history.accept('one', 'replace')).toBe(true);
    expect(history.index()).toBe(0);
    expect(history.entries()).toEqual(['one', 'two', 'three']);
  });

  it('transfers positional history when a layout replaces an id', () => {
    const histories = createSplitRouterHistories<string, string>(Object.is);

    histories.reconcile([{ id: 'first', entry: 'one' }], 'replace', 'move');
    histories.reconcile([{ id: 'first', entry: 'two' }], 'push', 'write');
    histories.reconcile([{ id: 'second', entry: 'two' }], 'replace', 'move');

    expect(histories.get('first')).toBeUndefined();
    expect(histories.get('second')?.entries()).toEqual(['one', 'two']);

    histories.reconcile([], 'replace', 'move');
    expect(histories.get('second')).toBeUndefined();
  });

  it('ignores invalid deltas and structurally equal writes', () => {
    const history = createSplitRouterHistory(
      { value: 'one' },
      (left, right) => left.value === right.value
    );

    expect(history.push({ value: 'one' })).toBe(false);
    expect(history.replace({ value: 'one' })).toBe(false);
    expect(history.canGo(0)).toBe(false);
    expect(history.go(Number.NaN)).toBe(false);
  });
});
