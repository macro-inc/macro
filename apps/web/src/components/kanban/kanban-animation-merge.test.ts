import { afterEach, expect, it, vi } from 'vitest';
import {
  createKanbanAnimation,
  type KanbanAnimationItem,
} from './kanban-animation';

let cancel: (() => void) | undefined;
const originalAnimate = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'animate'
);

afterEach(() => {
  cancel?.();
  document.body.replaceChildren();

  if (originalAnimate) {
    Object.defineProperty(HTMLElement.prototype, 'animate', originalAnimate);
  } else {
    delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
  }

  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function fixture() {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(0), 16)
  );
  vi.stubGlobal('cancelAnimationFrame', (id: number) =>
    window.clearTimeout(id)
  );

  const animate = vi.fn(() => ({
    cancel: vi.fn(),
    finished: new Promise(() => {}),
  }));
  Object.defineProperty(HTMLElement.prototype, 'animate', {
    configurable: true,
    value: animate,
  });
  const viewport = document.createElement('div');
  viewport.getBoundingClientRect = () => new DOMRect(0, 0, 900, 600);
  document.body.append(viewport);
  let items: KanbanAnimationItem[] = [];

  function placement(key: string, x: number, parentKey?: string) {
    const layout = document.createElement('div');
    const element = document.createElement('article');
    element.textContent = key;
    let top = 0;
    let offset = 0;
    layout.getBoundingClientRect = () => new DOMRect(x, top, 100, 80);
    element.getBoundingClientRect = () => new DOMRect(x, top + offset, 100, 80);
    layout.append(element);
    viewport.append(layout);
    const item = { key, identity: 'task', parentKey, element, layout };
    items.push(item);

    return {
      ...item,
      move(nextTop: number, animationOffset = 0) {
        top = nextTop;
        offset = animationOffset;
        layout.style.transform = `translateY(${top}px)`;
      },
      remove() {
        items = items.filter((entry) => entry !== item);
        layout.remove();
      },
    };
  }

  const motion = createKanbanAnimation({
    viewport: () => viewport,
    items: () => items,
  });
  cancel = motion.cancel;
  return { motion, animate, placement };
}

async function frame() {
  await Promise.resolve();
  vi.advanceTimersByTime(16);
}

it('animates a removed assignee placement into an existing destination placement', async () => {
  const board = fixture();
  const alice = board.placement('alice:task', 0, 'alice');
  const bob = board.placement('bob:task', 300, 'bob');
  const carol = board.placement('carol:task', 600, 'carol');
  const finish = board.motion.begin('task', 'bob', {
    key: alice.key,
    element: alice.element,
    rect: new DOMRect(280, 50, 100, 80),
    parentKey: 'alice',
  });
  alice.remove();
  await frame();

  const ghost = document.body.querySelector<HTMLElement>(
    '[aria-hidden="true"]'
  );
  expect(ghost).not.toBeNull();
  expect(ghost?.textContent).toBe('alice:task');
  expect(ghost?.inert).toBe(true);
  expect(ghost?.style.left).toBe('280px');
  expect(ghost?.style.top).toBe('50px');
  expect(board.animate.mock.contexts).toContain(bob.element);
  expect(board.animate.mock.contexts).not.toContain(carol.element);
  finish();
});

it('retargets from the old visual position, not the already updated layout', async () => {
  const board = fixture();
  const card = board.placement('alice:task', 0);
  board.motion.begin('task');
  card.move(120);
  await frame();

  // The old animation is halfway from 0 to 120 when layout changes to 240.
  // The DOM now reports 240 - 60, but the user last saw 120 - 60 = 60.
  card.move(240, -60);
  await frame();

  expect(board.animate).toHaveBeenLastCalledWith(
    [{ transform: 'translate(0px, -180px)' }, { transform: 'translate(0, 0)' }],
    expect.anything()
  );
});

it('does not animate a child twice when its parent FLIP is interrupted', async () => {
  const board = fixture();
  const column = board.placement('lane', 0);
  const card = board.placement('lane:task', 0, 'lane');
  board.motion.begin('task');
  column.move(120);
  card.move(120);
  await frame();
  expect(board.animate).toHaveBeenCalledTimes(1);

  column.move(240, -60);
  card.move(240);
  // Even an unanimated child wrapper inherits its parent's running transform.
  card.layout.getBoundingClientRect = () => new DOMRect(0, 180, 100, 80);
  card.element.getBoundingClientRect = card.layout.getBoundingClientRect;
  await frame();

  expect(board.animate).toHaveBeenCalledTimes(2);
  expect(board.animate.mock.contexts).toEqual([column.element, column.element]);
});
