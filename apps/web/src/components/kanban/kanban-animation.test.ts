import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createKanbanAnimation,
  type KanbanAnimationItem,
} from './kanban-animation';

const cleanups: (() => void)[] = [];
let animate: ReturnType<typeof vi.fn>;
let cancellations: ReturnType<typeof vi.fn>[];

beforeEach(() => {
  vi.useFakeTimers();
  cancellations = [];
  animate = vi.fn(() => {
    const cancel = vi.fn();
    cancellations.push(cancel);
    return { cancel, finished: new Promise(() => {}) };
  });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(0), 16)
  );
  vi.stubGlobal('cancelAnimationFrame', (id: number) =>
    window.clearTimeout(id)
  );
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  Object.defineProperty(HTMLElement.prototype, 'animate', {
    configurable: true,
    value: animate,
  });
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }

  document.body.replaceChildren();
  delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function fixture() {
  const viewport = document.createElement('div');
  viewport.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
  document.body.append(viewport);
  let items: KanbanAnimationItem[] = [];
  const motion = createKanbanAnimation({
    viewport: () => viewport,
    items: () => items,
  });
  cleanups.push(motion.cancel);

  function item(
    key: string,
    x: number,
    y: number,
    identity?: string,
    parentKey?: string,
    placeholder = false
  ) {
    const layout = document.createElement('div');
    const element = document.createElement('article');
    layout.append(element);
    viewport.append(layout);
    let rect = new DOMRect(x, y, 100, 80);
    layout.getBoundingClientRect = () => rect;
    const entry = { key, identity, parentKey, placeholder, element, layout };
    items = [...items, entry];

    return {
      ...entry,
      move(left: number, top: number) {
        rect = new DOMRect(left, top, 100, 80);
        layout.style.transform = `translate(${left}px, ${top}px)`;
      },
      remove() {
        items = items.filter((item) => item !== entry);
        layout.remove();
      },
    };
  }

  return { viewport, motion, item };
}

async function frame() {
  await Promise.resolve();
  vi.advanceTimersByTime(16);
}

describe('Kanban layout animation', () => {
  it('animates inner cards without touching virtualizer transforms', async () => {
    const board = fixture();
    const card = board.item('a:task', 0, 0, 'task');
    const finish = board.motion.begin('task');
    card.move(0, 120);
    await frame();

    expect(animate).toHaveBeenCalledWith(
      [
        { transform: 'translate(0px, -120px)' },
        { transform: 'translate(0, 0)' },
      ],
      expect.objectContaining({ duration: 200 })
    );
    expect(animate.mock.contexts[0]).toBe(card.element);
    expect(card.layout.style.transform).toBe('translate(0px, 120px)');
    finish();
  });

  it('does not animate ordinary virtualization or scrolling', async () => {
    const board = fixture();
    const card = board.item('a:task', 0, 0, 'task');
    card.move(0, 120);
    await frame();
    expect(animate).not.toHaveBeenCalled();

    board.motion.begin('task');
    card.move(0, 240);
    board.viewport.dispatchEvent(new Event('scroll'));
    await frame();
    expect(animate).not.toHaveBeenCalled();
  });

  it('animates remounted cross-column cards with inert visual copies', async () => {
    const board = fixture();
    const source = board.item('a:task', 0, 0, 'task');
    source.element.id = 'original';
    board.motion.begin('task');
    source.remove();
    board.item('b:task', 300, 100, 'task');
    await frame();

    const ghost = document.body.querySelector<HTMLElement>(
      '[aria-hidden="true"]'
    );
    expect(ghost?.inert).toBe(true);
    expect(ghost?.id).toBe('');
    expect(ghost?.style.pointerEvents).toBe('none');
    expect(animate).toHaveBeenCalledTimes(2);
    board.motion.cancel();
    expect(ghost?.isConnected).toBe(false);
  });

  it('subtracts parent movement to avoid moving nested cards twice', async () => {
    const board = fixture();
    const column = board.item('a', 0, 0);
    const card = board.item('a:task', 0, 40, 'task', 'a');
    board.motion.begin('task');
    column.move(300, 0);
    card.move(300, 40);
    await frame();
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate.mock.contexts[0]).toBe(column.element);
  });

  it('respects reduced motion', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const board = fixture();
    const card = board.item('a:task', 0, 0, 'task');
    const finish = board.motion.begin('task');
    card.move(200, 100);
    finish();
    await frame();
    expect(animate).not.toHaveBeenCalled();
  });

  it('ignores stale completion after cancellation', async () => {
    const board = fixture();
    const card = board.item('a:task', 0, 0, 'task');
    const finish = board.motion.begin('task');
    board.motion.cancel();
    card.move(300, 100);
    finish();
    await frame();
    expect(animate).not.toHaveBeenCalled();
  });

  it('keeps observing concurrent moves until all finish', async () => {
    const board = fixture();
    const card = board.item('a:task', 0, 0, 'task');
    const first = board.motion.begin('task');
    const second = board.motion.begin('task');
    first();
    await frame();
    card.move(0, 120);
    await frame();
    expect(animate).toHaveBeenCalledTimes(1);
    second();
    await frame();
    card.move(0, 240);
    await frame();
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it('animates rollback to the original placement', async () => {
    const board = fixture();
    const source = board.item('a:task', 0, 0, 'task');
    const finish = board.motion.begin('task');
    source.remove();
    const destination = board.item('b:task', 300, 0, 'task');
    await frame();
    destination.remove();
    board.item('a:task', 0, 0, 'task');
    finish();
    await frame();
    expect(animate).toHaveBeenCalledTimes(4);
    expect(cancellations[0]).toHaveBeenCalled();
  });

  it('copies only moving cards and preserves other assignee placements', async () => {
    const board = fixture();
    const alice = board.item('alice:task', 0, 0, 'task');
    const carol = board.item('carol:task', 600, 0, 'task');
    const unrelated = board.item('alice:other', 0, 100, 'other');
    const clone = vi.spyOn(unrelated.element, 'cloneNode');
    board.motion.begin('task');
    alice.remove();
    board.item('bob:task', 300, 0, 'task');
    await frame();

    expect(clone).not.toHaveBeenCalled();
    expect(animate).toHaveBeenCalledTimes(2);
    expect(animate.mock.contexts).not.toContain(carol.element);
    clone.mockRestore();
  });

  it('animates hover placeholder and displaced cards without moving layout wrappers', async () => {
    const board = fixture();
    const first = board.item('lane:first', 0, 0);
    const second = board.item('lane:second', 0, 116);
    const endHover = board.motion.beginHover();
    const placeholder = board.item(
      'lane:placeholder',
      0,
      116,
      undefined,
      undefined,
      true
    );
    second.move(0, 232);
    await frame();

    expect(animate.mock.contexts).toContain(second.element);
    expect(animate.mock.contexts).toContain(placeholder.element);
    expect(animate.mock.contexts).not.toContain(second.layout);
    expect(animate.mock.contexts).not.toContain(first.element);
    endHover();
  });

  it('retargets a moving hover slot from its current visual position', async () => {
    const board = fixture();
    board.motion.beginHover();
    const slot = board.item(
      'lane:placeholder',
      0,
      116,
      undefined,
      undefined,
      true
    );
    await frame();

    // After layout moves to 232, the current local residual is +34.
    slot.element.getBoundingClientRect = () => new DOMRect(0, 266, 100, 80);
    slot.move(0, 232);
    await frame();
    expect(cancellations[0]).toHaveBeenCalledOnce();
    expect(animate).toHaveBeenLastCalledWith(
      [
        { transform: 'translate(0px, -82px)' },
        { transform: 'translate(0, 0)' },
      ],
      expect.objectContaining({ duration: 200 })
    );
    expect(animate.mock.contexts.at(-1)).toBe(slot.element);
  });

  it('flies hover placeholders across clipped columns and clears invalid flights', async () => {
    const board = fixture();
    const source = board.item(
      'a:placeholder',
      0,
      116,
      undefined,
      undefined,
      true
    );
    board.motion.beginHover();
    source.remove();
    const destination = board.item(
      'b:placeholder',
      300,
      232,
      undefined,
      undefined,
      true
    );
    await frame();

    const ghost = document.body.querySelector<HTMLElement>(
      '[aria-hidden="true"]'
    );
    expect(ghost).not.toBeNull();
    expect(ghost?.inert).toBe(true);
    expect(ghost?.style.position).toBe('fixed');
    expect(ghost?.style.pointerEvents).toBe('none');
    expect(animate.mock.contexts).toContain(ghost);
    expect(animate).toHaveBeenCalledWith(
      [
        { transform: 'translate(0, 0)', opacity: 1 },
        { transform: 'translate(300px, 116px)', opacity: 0 },
      ],
      expect.anything()
    );

    destination.remove();
    await frame();
    expect(ghost?.isConnected).toBe(false);
    expect(document.body.querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it('retargets an interrupted placeholder flight from its live ghost rectangle and opacity', async () => {
    const board = fixture();
    const source = board.item(
      'a:placeholder',
      0,
      116,
      undefined,
      undefined,
      true
    );
    board.motion.beginHover();
    source.remove();
    const middle = board.item(
      'b:placeholder',
      300,
      232,
      undefined,
      undefined,
      true
    );
    await frame();

    const ghost = document.body.querySelector<HTMLElement>(
      '[aria-hidden="true"]'
    )!;
    ghost.style.opacity = '0.6';
    ghost.getBoundingClientRect = () => new DOMRect(150, 174, 100, 80);
    middle.remove();
    board.item('c:placeholder', 600, 300, undefined, undefined, true);
    await frame();

    expect(ghost.isConnected).toBe(false);
    const newGhost = document.body.querySelector<HTMLElement>(
      '[aria-hidden="true"]'
    );
    expect(newGhost).not.toBeNull();
    expect(newGhost?.style.left).toBe('150px');
    expect(newGhost?.style.top).toBe('174px');
    expect(newGhost?.style.opacity).toBe('0.6');
    expect(animate).toHaveBeenCalledWith(
      [
        { transform: 'translate(0, 0)', opacity: 0.6 },
        { transform: 'translate(450px, 126px)', opacity: 0 },
      ],
      expect.anything()
    );
  });

  it('retargets an interrupted transition from the current visual position', async () => {
    const board = fixture();
    const card = board.item('lane:card', 0, 0);
    board.motion.beginHover();
    card.move(0, 120);
    await frame();

    // After layout moves to 240, the current local residual is -50.
    card.element.getBoundingClientRect = () => new DOMRect(0, 190, 100, 80);
    card.move(0, 240);
    await frame();
    expect(cancellations[0]).toHaveBeenCalledOnce();
    expect(animate).toHaveBeenLastCalledWith(
      [
        { transform: 'translate(0px, -170px)' },
        { transform: 'translate(0, 0)' },
      ],
      expect.objectContaining({ duration: 200 })
    );
  });

  it('removes a cleared hover placeholder without leaving a ghost', async () => {
    const board = fixture();
    const card = board.item('lane:card', 0, 116);
    board.motion.beginHover();
    const placeholder = board.item('lane:placeholder', 0, 0);
    card.move(0, 232);
    await frame();
    placeholder.remove();
    card.move(0, 116);
    await frame();

    expect(placeholder.element.isConnected).toBe(false);
    expect(document.body.querySelector('[aria-hidden="true"]')).toBeNull();
    expect(cancellations.some((cancel) => cancel.mock.calls.length > 0)).toBe(
      true
    );
  });

  it('skips hover transitions for reduced motion', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const board = fixture();
    const card = board.item('lane:card', 0, 0);
    board.motion.beginHover();
    card.move(0, 116);
    await frame();
    expect(animate).not.toHaveBeenCalled();
  });

  it('cancels animation before a new pointer interaction', async () => {
    const board = fixture();
    const card = board.item('a:task', 0, 0, 'task');
    board.motion.begin('task');
    card.move(0, 120);
    await frame();
    board.viewport.dispatchEvent(new Event('pointerdown', { bubbles: true }));

    expect(cancellations[0]).toHaveBeenCalledOnce();
    await frame();
    expect(animate).toHaveBeenCalledTimes(1);
  });
});
