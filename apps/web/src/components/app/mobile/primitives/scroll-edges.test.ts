import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createScrollEdges, type ScrollEdgeSource } from './scroll-edges';

describe('sheet scroll edges', () => {
  it('updates on scrolling and resizing, and releases the old source', () => {
    const state = createRoot((dispose) => {
      let onScroll = () => {};
      let onResize = () => {};
      const remove = vi.fn();
      const stop = vi.fn();
      const scroller: ScrollEdgeSource = {
        scrollTop: 0,
        scrollHeight: 500,
        clientHeight: 200,
        addEventListener: (_type, listener) => {
          onScroll = listener;
        },
        removeEventListener: remove,
      };
      const [source, setSource] = createSignal<ScrollEdgeSource | undefined>(
        scroller
      );
      const edges = createScrollEdges(source, (_source, update) => {
        onResize = update;
        return stop;
      });
      return {
        dispose,
        edges,
        scroller,
        onScroll: () => onScroll(),
        onResize: () => onResize(),
        setSource,
        remove,
        stop,
      };
    });
    expect(state.edges).toMatchObject({ above: false, below: true });
    state.scroller.scrollTop = 300;
    state.onScroll();
    expect(state.edges).toMatchObject({ above: true, below: false });
    state.scroller.scrollHeight = 700;
    state.onResize();
    expect(state.edges.below).toBe(true);
    state.setSource(undefined);
    expect(state.edges).toMatchObject({ above: false, below: false });
    expect(state.remove).toHaveBeenCalledOnce();
    expect(state.stop).toHaveBeenCalledOnce();
    state.dispose();
  });
});
