import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createComponent, createSignal } from 'solid-js';
import { insert } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { Gantt, useGantt } from './gantt';
import type { GanttGroupMove } from './gantt-group-drag';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fixture(withPreview = false) {
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  const [allowed, setAllowed] = createSignal(true);
  const [scope, setScope] = createSignal('status');
  const move = vi.fn(async (_move: GanttGroupMove) => {});
  const open = vi.fn();
  const [rows, setRows] = createSignal([{ id: 'a:one', name: 'Original row' }]);
  const renderNormal = vi.fn((row: { id: string; name: string }) => {
    const element = document.createElement('div');
    element.dataset.stableRow = row.id;
    element.textContent = row.name;
    return element;
  });
  const viewport = document.createElement('div');
  viewport.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
  render(() =>
    createComponent(Gantt.Root, {
      range: { start: 0, end: 100 },
      get children() {
        return createComponent(Gantt.GroupDrag, {
          get scope() {
            return scope();
          },
          canDrag: () => allowed(),
          canDrop: () => allowed(),
          onMove: move,
          getPlacement: () => ({ index: 0 }),
          get children() {
            return createComponent(() => {
              const gantt = useGantt();
              gantt.setViewport(viewport);
              const label = document.createElement('div');
              label.dataset.ganttLabel = '';
              const button = document.createElement('button');
              button.textContent = 'Source';
              button.onclick = open;
              button.getBoundingClientRect = () => new DOMRect(8, 86, 264, 28);
              label.append(button);
              const body = document.createElement('div');
              body.dataset.ganttBarBody = '';
              body.getBoundingClientRect = () => new DOMRect(150, 86, 1000, 28);
              const bar = document.createElement('button');
              const text = document.createElement('span');
              text.dataset.ganttBarLabel = '';
              text.style.position = 'sticky';
              text.textContent = 'Bar';
              bar.append(text);
              bar.onclick = open;
              const resize = document.createElement('button');
              resize.textContent = 'Resize';
              body.append(bar, resize);
              insert(
                viewport,
                createComponent(Gantt.DragItem, {
                  id: 'one',
                  key: 'a:one',
                  groupId: 'a',
                  label: 'Source',
                  get children() {
                    return createComponent(Gantt.Row, {
                      children: [label, body],
                    });
                  },
                })
              );
              insert(
                viewport,
                createComponent(Gantt.Row, {
                  get children() {
                    return createComponent(Gantt.GroupDrop, {
                      id: 'b',
                      groupId: 'b',
                    });
                  },
                })
              );
              if (withPreview)
                insert(
                  viewport,
                  createComponent(Gantt.Rows<{ id: string; name: string }>, {
                    get items() {
                      return rows();
                    },
                    getKey: (row) => row.id,
                    children: renderNormal,
                    renderDropPreview: () => 'Destination ghost',
                  })
                );
              return viewport;
            }, {});
          },
        });
      },
    })
  );
  viewport.querySelector<HTMLElement>(
    '[data-gantt-group-drop]'
  )!.getBoundingClientRect = () => new DOMRect(0, 200, 800, 40);
  const press = (source = 'Source') =>
    fireEvent.mouseDown(screen.getByRole('button', { name: source }), {
      clientX: 300,
      clientY: 100,
      button: 0,
    });
  const hover = (y = 220) =>
    fireEvent.mouseMove(document, { clientX: 300, clientY: y });
  const release = () =>
    fireEvent.mouseUp(document, { clientX: 300, clientY: 220 });
  return {
    move,
    open,
    press,
    hover,
    release,
    setAllowed,
    setScope,
    viewport,
    renderNormal,
    setRows,
  };
}

it.each(['Source', 'Bar'])(
  'moves from %s only after the drag threshold and suppresses opening',
  async (source) => {
    const chart = fixture();
    chart.press(source);
    chart.hover(105);
    chart.release();
    expect(chart.move).not.toHaveBeenCalled();
    chart.press(source);
    chart.hover();
    chart.release();
    fireEvent.click(screen.getByRole('button', { name: source }));
    await waitFor(() => expect(chart.move).toHaveBeenCalledOnce());
    expect(chart.move).toHaveBeenCalledWith({
      id: 'one',
      fromGroup: 'a',
      toGroup: 'b',
    });
    expect(chart.open).not.toHaveBeenCalled();
  }
);
it.each(['escape', 'permission', 'scope', 'outside'])(
  'rejects a drop after %s changes during the drag',
  (change) => {
    const chart = fixture();
    chart.press();
    chart.hover();
    if (change === 'escape') fireEvent.keyDown(document, { key: 'Escape' });
    if (change === 'permission') chart.setAllowed(false);
    if (change === 'scope') chart.setScope('priority');
    if (change === 'outside') chart.hover(700);
    chart.release();
    expect(chart.move).not.toHaveBeenCalled();
  }
);

it('keeps the resize handle separate from group dragging', () => {
  const chart = fixture();
  chart.press('Resize');
  chart.hover();
  chart.release();
  expect(chart.move).not.toHaveBeenCalled();
});

it('blocks a second drag while saving and reports failure before allowing a retry', async () => {
  const chart = fixture();
  let reject!: (error: Error) => void;
  chart.move.mockImplementationOnce(
    () =>
      new Promise<void>((_resolve, fail) => {
        reject = fail;
      })
  );
  chart.press();
  chart.hover();
  chart.release();
  chart.press('Bar');
  chart.hover();
  chart.release();
  expect(chart.move).toHaveBeenCalledOnce();
  reject(new Error('offline'));
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toBe(
      'Could not move item. Try again.'
    )
  );
  chart.press();
  chart.hover();
  chart.release();
  await waitFor(() => expect(chart.move).toHaveBeenCalledTimes(2));
});

it('snapshots the visible bar and keeps its clone inert while reserving a destination row', async () => {
  const chart = fixture(true);
  const original = screen.getByRole('button', { name: 'Bar' });
  chart.press('Bar');
  chart.hover();
  const snapshot = document.querySelector<HTMLElement>(
    '[data-gantt-drag-preview]'
  )!;
  expect(snapshot.style.width).toBe('540px');
  expect(snapshot.inert).toBe(true);
  expect(snapshot.getAttribute('aria-hidden')).toBe('true');
  expect(
    snapshot.querySelector<HTMLElement>('[data-gantt-bar-label]')!.style
      .position
  ).toBe('static');
  const ghost = chart.viewport.querySelector<HTMLElement>(
    '[data-gantt-drop-preview]'
  )!;
  expect(ghost.textContent).toBe('Destination ghost');
  chart.hover();
  expect(chart.viewport.querySelector('[data-gantt-drop-preview]')).toBe(ghost);
  expect(chart.renderNormal).toHaveBeenCalledOnce();
  const retained = chart.viewport.querySelector('[data-stable-row]');
  chart.setRows([{ id: 'a:one', name: 'Replacement' }]);
  expect(chart.viewport.querySelector('[data-stable-row]')).toBe(retained);
  chart.setRows([]);
  expect(chart.viewport.querySelector('[data-stable-row]')).toBe(retained);
  chart.setRows([{ id: 'a:one', name: 'Replacement' }]);
  expect(screen.getByRole('button', { name: 'Bar' })).toBe(original);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(chart.viewport.querySelector('[data-gantt-drop-preview]')).toBeNull();
  expect(document.querySelector('[data-gantt-drag-preview]')).toBeNull();
  expect(chart.viewport.querySelector('[data-stable-row]')?.textContent).toBe(
    'Replacement'
  );
  chart.release();
  expect(chart.move).not.toHaveBeenCalled();
});
