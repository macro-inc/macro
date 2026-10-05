import { createRoot } from 'solid-js';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { Box, MeasuredSection } from '../core/drop-target';
import type { QuestionPlacement } from '../core/form-layout';
import type { FormLayout } from '../core/form-model';
import { createBuilderDrag, type DragTarget } from './create-builder-drag';

/** jsdom has neither pointer events nor pointer capture. */
class PointerEventPolyfill extends MouseEvent {
  readonly pointerId: number;
  readonly pointerType: string;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? 'mouse';
  }
}

beforeAll(() => {
  if (typeof globalThis.PointerEvent === 'undefined')
    Object.defineProperty(globalThis, 'PointerEvent', {
      value: PointerEventPolyfill,
      configurable: true,
    });
  const captured = new WeakMap<Element, Set<number>>();
  Object.defineProperties(HTMLElement.prototype, {
    setPointerCapture: {
      configurable: true,
      value(this: HTMLElement, id: number) {
        const ids = captured.get(this) ?? new Set<number>();
        ids.add(id);
        captured.set(this, ids);
      },
    },
    hasPointerCapture: {
      configurable: true,
      value(this: HTMLElement, id: number) {
        return captured.get(this)?.has(id) ?? false;
      },
    },
    releasePointerCapture: {
      configurable: true,
      value(this: HTMLElement, id: number) {
        captured.get(this)?.delete(id);
      },
    },
  });
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
  document.body.removeAttribute('style');
});

const question = (id: string) => ({
  id,
  columnId: `column-${id}`,
  helpText: '',
  required: false,
  widget: null,
});

/** Three questions in "about", an empty "later" section far below. */
const layout: FormLayout = {
  sections: [
    {
      id: 'about',
      title: 'About',
      description: '',
      kind: 'questions',
      gateRules: null,
      gateMessage: '',
      questions: [question('q1'), question('q2'), question('q3')],
    },
    {
      id: 'later',
      title: 'Later',
      description: '',
      kind: 'questions',
      gateRules: null,
      gateMessage: '',
      questions: [],
    },
  ],
};

/** A 300px viewport over 1200px of content; boxes move as it scrolls. */
function setup() {
  let scrollTop = 0;
  const viewport = document.createElement('div');
  Object.defineProperty(viewport, 'scrollTop', {
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = Math.max(0, Math.min(900, value));
    },
  });
  viewport.getBoundingClientRect = () => new DOMRect(0, 0, 600, 300);
  const handle = document.createElement('button');
  const other = document.createElement('button');
  const source = document.createElement('div');
  source.setAttribute('data-drag-source', '');
  source.append(handle);
  document.body.append(viewport, source, other);
  const box = (top: number, bottom: number): Box => ({
    top: top - scrollTop,
    bottom: bottom - scrollTop,
    left: 0,
    right: 600,
  });
  const measureQuestions = (): MeasuredSection[] => [
    {
      id: 'about',
      kind: 'questions',
      box: box(0, 280),
      list: box(30, 270),
      questions: [
        { id: 'q1', box: box(40, 100) },
        { id: 'q2', box: box(110, 170) },
        { id: 'q3', box: box(180, 240) },
      ],
    },
    {
      id: 'later',
      kind: 'questions',
      box: box(1000, 1150),
      list: box(1040, 1120),
      questions: [],
    },
  ];
  const drops: [string, QuestionPlacement][] = [];
  const focused: DragTarget[] = [];
  const drag = createBuilderDrag({
    layout: () => layout,
    viewport: () => viewport,
    measureQuestions,
    measureSections: () =>
      measureQuestions().map(({ id, box: sectionBox }) => ({
        id,
        box: sectionBox,
      })),
    refusalForQuestion: () => undefined,
    refusalForSection: () => undefined,
    dropQuestion: (questionId, placement) =>
      drops.push([questionId, placement]),
    dropSection: () => {},
    describe: (target) => target.id,
    describePlacement: (_, placement) =>
      `${placement.sectionId} ${placement.index + 1}`,
    focusHandle: (target) => focused.push(target),
  });
  const props = drag.handleProps(() => ({ kind: 'question', id: 'q1' }));
  handle.addEventListener('pointerdown', props.onPointerDown);
  handle.addEventListener('keydown', props.onKeyDown);
  handle.addEventListener('blur', props.onBlur);
  const key = (name: string) =>
    handle.dispatchEvent(
      new KeyboardEvent('keydown', { key: name, bubbles: true })
    );
  return { drag, handle, other, drops, focused, key, viewport };
}

describe('createBuilderDrag keyboard', () => {
  it('picks up with Space, moves with ArrowDown, drops with Space, writes once and keeps focus on the handle', () => {
    createRoot((dispose) => {
      const { drag, drops, focused, key } = setup();
      key(' ');
      expect(drag.session()?.placement).toEqual({
        sectionId: 'about',
        index: 0,
      });
      key('ArrowDown');
      expect(drag.session()?.placement).toEqual({
        sectionId: 'about',
        index: 1,
      });
      expect(drag.session()?.lineY).toBe(175);
      key(' ');
      expect(drag.session()).toBeUndefined();
      expect(drops).toEqual([['q1', { sectionId: 'about', index: 1 }]]);
      vi.runAllTimers();
      expect(focused).toEqual([{ kind: 'question', id: 'q1' }]);
      dispose();
    });
  });

  it('cancels on Tab without pulling focus back to the handle', () => {
    createRoot((dispose) => {
      const { drag, drops, focused, key } = setup();
      key(' ');
      key('ArrowDown');
      key('Tab');
      expect(drag.session()).toBeUndefined();
      vi.runAllTimers();
      expect(focused).toEqual([]);
      expect(drops).toEqual([]);
      dispose();
    });
  });

  it('cancels when the handle loses focus, leaving focus where it went', () => {
    createRoot((dispose) => {
      const { drag, focused, key, handle, other } = setup();
      handle.focus();
      key(' ');
      other.focus();
      expect(drag.session()).toBeUndefined();
      vi.runAllTimers();
      expect(focused).toEqual([]);
      expect(document.activeElement).toBe(other);
      dispose();
    });
  });

  it('cancels on Escape and hands focus back to the handle, writing nothing', () => {
    createRoot((dispose) => {
      const { drag, drops, focused, key } = setup();
      key(' ');
      key('ArrowDown');
      key('Escape');
      expect(drag.session()).toBeUndefined();
      vi.runAllTimers();
      expect(focused).toEqual([{ kind: 'question', id: 'q1' }]);
      expect(drops).toEqual([]);
      dispose();
    });
  });

  it('measures the drop line again after scrolling a distant section into view', () => {
    createRoot((dispose) => {
      const { drag, key, viewport } = setup();
      key(' ');
      key('ArrowDown');
      key('ArrowDown');
      key('ArrowDown');
      expect(drag.session()?.placement).toEqual({
        sectionId: 'later',
        index: 0,
      });
      expect(viewport.scrollTop).toBeGreaterThan(0);
      const lineY = drag.session()?.lineY ?? Number.NaN;
      // The empty section's list middle (1080 in content), where it now sits.
      expect(lineY).toBe(1080 - viewport.scrollTop);
      expect(lineY).toBeGreaterThanOrEqual(0);
      expect(lineY).toBeLessThanOrEqual(300);
      dispose();
    });
  });
});

describe('createBuilderDrag pointer', () => {
  it('drags past the threshold, restores the body’s own user-select, and writes once on release', () => {
    createRoot((dispose) => {
      const { drag, handle, drops } = setup();
      document.body.style.userSelect = 'text';
      handle.dispatchEvent(
        new PointerEvent('pointerdown', {
          pointerId: 7,
          clientX: 10,
          clientY: 60,
          button: 0,
          bubbles: true,
        })
      );
      handle.dispatchEvent(
        new PointerEvent('pointermove', {
          pointerId: 7,
          clientX: 10,
          clientY: 62,
        })
      );
      expect(drag.session()).toBeUndefined();
      handle.dispatchEvent(
        new PointerEvent('pointermove', {
          pointerId: 7,
          clientX: 10,
          clientY: 200,
        })
      );
      expect(drag.session()?.mode).toBe('pointer');
      expect(document.body.style.userSelect).toBe('none');
      expect(document.querySelectorAll('[data-drag-preview]')).toHaveLength(1);
      handle.dispatchEvent(
        new PointerEvent('pointerup', {
          pointerId: 7,
          clientX: 10,
          clientY: 200,
        })
      );
      // 200px is above q3's middle: between q2 and q3.
      expect(drops).toEqual([['q1', { sectionId: 'about', index: 1 }]]);
      expect(document.body.style.userSelect).toBe('text');
      expect(document.querySelectorAll('[data-drag-preview]')).toHaveLength(0);
      dispose();
    });
  });

  it('cancels a pointer drag on Tab without refocusing, and on Escape with it', () => {
    createRoot((dispose) => {
      const { drag, handle, drops, focused } = setup();
      const start = () => {
        handle.dispatchEvent(
          new PointerEvent('pointerdown', {
            pointerId: 3,
            clientX: 0,
            clientY: 60,
            button: 0,
          })
        );
        handle.dispatchEvent(
          new PointerEvent('pointermove', {
            pointerId: 3,
            clientX: 0,
            clientY: 200,
          })
        );
      };
      start();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
      expect(drag.session()).toBeUndefined();
      vi.runAllTimers();
      expect(focused).toEqual([]);
      start();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(drag.session()).toBeUndefined();
      vi.runAllTimers();
      expect(focused).toEqual([{ kind: 'question', id: 'q1' }]);
      expect(drops).toEqual([]);
      dispose();
    });
  });

  it('starts a touch drag only after a still long-press', () => {
    createRoot((dispose) => {
      const { drag, handle } = setup();
      handle.dispatchEvent(
        new PointerEvent('pointerdown', {
          pointerId: 9,
          pointerType: 'touch',
          clientX: 0,
          clientY: 60,
          button: 0,
        })
      );
      vi.advanceTimersByTime(150);
      expect(drag.session()).toBeUndefined();
      vi.advanceTimersByTime(60);
      expect(drag.session()?.mode).toBe('pointer');
      handle.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 9 }));
      expect(drag.session()).toBeUndefined();
      dispose();
    });
  });
});
