import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import {
  getListNavigationSource,
  type ListNavigationSource,
  registerListNavigationSource,
} from './list-navigation-source';

const source = (): ListNavigationSource => ({
  viewId: 'mail',
  entities: () => [],
  hasMore: () => false,
  loadMore: async () => {},
});
describe('list navigation source lifetime', () => {
  it('keeps lists isolated by split and removes disposed sources', () => {
    const first = source(),
      second = source();
    const disposeFirst = createRoot((dispose) => {
      registerListNavigationSource('first', first);
      return dispose;
    });
    const disposeSecond = createRoot((dispose) => {
      registerListNavigationSource('second', second);
      return dispose;
    });
    expect(getListNavigationSource('first')).toBe(first);
    expect(getListNavigationSource('second')).toBe(second);
    disposeFirst();
    expect(getListNavigationSource('first')).toBeUndefined();
    expect(getListNavigationSource('second')).toBe(second);
    disposeSecond();
  });
  it('does not remove a replacement when an older owner is disposed', () => {
    const old = source(),
      replacement = source();
    const disposeOld = createRoot((dispose) => {
      registerListNavigationSource('same', old);
      return dispose;
    });
    const disposeNew = createRoot((dispose) => {
      registerListNavigationSource('same', replacement);
      return dispose;
    });
    disposeOld();
    expect(getListNavigationSource('same')).toBe(replacement);
    disposeNew();
    expect(getListNavigationSource('same')).toBeUndefined();
  });
});
