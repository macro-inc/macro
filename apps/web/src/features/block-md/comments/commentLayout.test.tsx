import { cleanup, render } from '@solidjs/testing-library';
import { createEditor } from 'lexical';
import { createStore } from 'solid-js/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCommentLayout,
  MIN_THREAD_GAP,
  stackMarginThreads,
} from './commentLayout';
import type { MarkStore } from './commentType';

const listeners = vi.hoisted(() => ({
  layoutShift: () => {},
  editorResize: () => {},
}));

vi.mock('@core/component/LexicalMarkdown/plugins', () => ({
  autoRegister: () => {},
  registerInternalLayoutShiftListener: (
    _editor: unknown,
    callback: () => void
  ) => {
    listeners.layoutShift = callback;
    return () => {};
  },
  registerEditorWidthObserver: (_editor: unknown, callback: () => void) => {
    listeners.editorResize = callback;
    return () => {};
  },
}));

vi.mock('@solid-primitives/resize-observer', () => ({
  createElementSize: () => ({ width: 1200, height: 10000 }),
}));

let state: ReturnType<typeof createFixture>['state'];
vi.mock('../context/markdown-document-context', () => ({
  useMarkdownDocument: () => ({ state }),
}));

class ResizeObserverStub implements ResizeObserver {
  static instances: ResizeObserverStub[] = [];
  targets = new Set<Element>();

  constructor(private callback: ResizeObserverCallback) {
    ResizeObserverStub.instances.push(this);
  }

  observe(target: Element) {
    this.targets.add(target);
  }

  unobserve(target: Element) {
    this.targets.delete(target);
  }

  disconnect() {
    this.targets.clear();
  }

  notify() {
    this.callback([], this);
  }
}

function createFixture() {
  const notebook = document.createElement('div');
  const margin = document.createElement('div');
  const mark = document.createElement('mark');
  let scrollTop = 5500;
  let anchorTop = 6000;
  vi.spyOn(margin, 'getBoundingClientRect').mockImplementation(
    () => new DOMRect(800, -scrollTop, 320, 10000)
  );
  vi.spyOn(mark, 'getBoundingClientRect').mockImplementation(
    () => new DOMRect(0, anchorTop - scrollTop, 100, 20)
  );
  const marks: MarkStore = {
    anchor: {
      id: 'anchor',
      markNodes: { node: mark },
      existsOnServer: true,
      owner: 'user',
      isDraft: false,
    },
  };
  const [fixtureState] = createStore({
    editor: {
      md: { notebook, commentMargin: margin, editor: createEditor() },
    },
    comments: { marks, activeMarkIds: [] as string[] },
  });
  return {
    state: fixtureState,
    margin,
    mark,
    // A resizing embed above the viewport triggers scroll anchoring, keeping
    // the highlighted text at the same screen Y despite its new document Y.
    resizeAboveAnchor(delta: number) {
      anchorTop += delta;
      scrollTop += delta;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  ResizeObserverStub.instances = [];
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('comment layout during document reflow', () => {
  it.each(['margin resize', 'editor resize', 'internal layout shift'])(
    'keeps comments beside their text through consecutive %s events',
    (event) => {
      const fixture = createFixture();
      state = fixture.state;
      let layout!: ReturnType<typeof createCommentLayout>;
      render(() => {
        layout = createCommentLayout();
        return null;
      });
      const notify = () => {
        if (event === 'editor resize') return listeners.editorResize();
        if (event === 'internal layout shift') return listeners.layoutShift();
        ResizeObserverStub.instances
          .find((observer) => observer.targets.has(fixture.margin))!
          .notify();
      };
      const cardTop = () =>
        fixture.margin.getBoundingClientRect().top +
        layout.threadPositions.anchor!.layout.calculatedYPos;
      const textTop = fixture.mark.getBoundingClientRect().top;
      expect(cardTop()).toBe(textTop);

      // Later events are inside the old 60ms throttle window. Each must
      // correct the position before paint, without waiting for a timer.
      for (const delta of [342, 200, -542]) {
        fixture.resizeAboveAnchor(delta);
        notify();
        expect(fixture.mark.getBoundingClientRect().top).toBe(textTop);
        expect(cardTop()).toBe(textTop);
      }
    }
  );
});

describe('stacking margin threads', () => {
  const thread = (id: string, top: number, height: number) => ({
    id,
    height,
    layout: { originalYPosition: top },
  });
  const tops = (layouts: ReturnType<typeof stackMarginThreads>) =>
    layouts.map((layout) => layout.layout.calculatedYPos);
  const expectNoOverlap = (
    threads: ReturnType<typeof thread>[],
    layouts: ReturnType<typeof stackMarginThreads>
  ) => {
    for (let i = 1; i < layouts.length; i++) {
      const previous = layouts[i - 1].layout;
      expect(layouts[i].layout.calculatedYPos).toBeGreaterThanOrEqual(
        previous.calculatedYPos + threads[i - 1].height + MIN_THREAD_GAP
      );
    }
  };

  it('keeps each thread beside its mark when they fit', () => {
    const threads = [thread('a', 100, 50), thread('b', 400, 50)];
    expect(tops(stackMarginThreads(threads, 0, 2000))).toEqual([100, 400]);
  });

  it('pushes the threads below a tall active thread past its end', () => {
    const threads = [thread('a', 100, 900), thread('b', 200, 300)];
    const layouts = stackMarginThreads(threads, 0, 2000);
    expect(tops(layouts)).toEqual([100, 100 + 900 + MIN_THREAD_GAP]);
    expectNoOverlap(threads, layouts);
  });

  it('keeps the active thread beside its text in a crowded margin', () => {
    // Twelve comments on consecutive lines: the cards above the active one
    // cannot fit between the top of the page and its text, so they pass the
    // top instead of pushing the active card away from its text.
    const threads = Array.from({ length: 12 }, (_, i) =>
      thread(String(i), 100 + i * 24, 90)
    );
    const layouts = stackMarginThreads(threads, 10, 2000);
    expect(tops(layouts)[10]).toBe(340);
    expect(tops(layouts)[0]).toBeLessThan(0);
    expect(layouts[0].layout.overflow).toBe('top');
    expectNoOverlap(threads, layouts);
  });

  it('never moves the active thread above the top of a short page', () => {
    const threads = [
      thread('above', 230, 400),
      thread('active', 350, 1300),
      thread('below', 600, 500),
    ];
    const layouts = stackMarginThreads(threads, 1, 750);
    expect(tops(layouts)[1]).toBe(0);
    expectNoOverlap(threads, layouts);
  });

  it('moves the active thread up only to end inside the page', () => {
    const threads = [thread('a', 50, 40), thread('active', 700, 200)];
    const layouts = stackMarginThreads(threads, 1, 800);
    expect(tops(layouts)).toEqual([50, 600]);
  });
});

describe('anchoring the margin on the active thread', () => {
  it('re-anchors when a thread is selected without changing height', () => {
    const notebook = document.createElement('div');
    const margin = document.createElement('div');
    vi.spyOn(margin, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(800, 0, 320, 2000)
    );
    const mark = (id: string, top: number): MarkStore[string] => {
      const element = document.createElement('mark');
      vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(
        new DOMRect(0, top, 100, 20)
      );
      return {
        id,
        markNodes: { [id]: element },
        existsOnServer: true,
        owner: 'user',
        isDraft: false,
        thread: {
          threadId: `thread-${id}`,
          rootId: `thread-${id}`,
          anchorId: id,
          comments: [],
          isResolved: false,
        },
      };
    };
    const [fixtureState, setFixtureState] = createStore({
      editor: {
        md: { notebook, commentMargin: margin, editor: createEditor() },
      },
      comments: {
        marks: { first: mark('first', 100), second: mark('second', 120) },
        activeMarkIds: [] as string[],
      },
    });
    state = fixtureState;
    let layout!: ReturnType<typeof createCommentLayout>;
    render(() => {
      layout = createCommentLayout();
      return null;
    });
    layout.setThreadHeights({ 'thread-first': 200, 'thread-second': 200 });
    const top = (id: string) =>
      layout.threadPositions[id]!.layout.calculatedYPos;
    expect([top('first'), top('second')]).toEqual([
      100,
      100 + 200 + MIN_THREAD_GAP,
    ]);

    setFixtureState('comments', 'activeMarkIds', ['second']);
    expect([top('first'), top('second')]).toEqual([
      120 - 200 - MIN_THREAD_GAP,
      120,
    ]);
  });
});
