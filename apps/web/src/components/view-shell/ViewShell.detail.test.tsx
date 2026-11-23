import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { createSignal, Show } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { useViewShell, ViewShell } from './ViewShell';

const measurement = vi.hoisted(() => ({
  width: (): number | undefined => 1600,
}));

vi.mock('@core/hotkey/hotkeys', () => ({ registerHotkey: vi.fn() }));

vi.mock('@solid-primitives/resize-observer', () => ({
  createResizeObserver: () => {},
  createElementSize: () => ({
    get width() {
      return measurement.width();
    },
    height: 800,
  }),
}));

vi.mock('./create-frame-width', () => ({
  createFrameWidth: () => () => measurement.width(),
}));

// The real barrel loads every control; this shell renders none of them.
vi.mock('@ui', async () => ({
  ...(await import('../ui/utils/classname')),
  ...(await import('../ui/utils/press')),
}));

afterEach(cleanup);

/** A list beside a reader that takes the rest, as Email's reading pane does. */
function setup(options: { shellWidth: number; listWidth: number }) {
  const [shellWidth, setShellWidth] = createSignal(options.shellWidth);
  const [listWidth, setListWidth] = createSignal(options.listWidth);
  measurement.width = shellWidth;

  function Panes() {
    const shell = useViewShell();
    return (
      <Show
        when={shell.detail.placement() === 'inline'}
        fallback={<ViewShell.Main>List</ViewShell.Main>}
      >
        <ViewShell.Main onWidthChangeEnd={setListWidth}>List</ViewShell.Main>
        <ViewShell.Detail>Reader</ViewShell.Detail>
      </Show>
    );
  }

  const view = render(() => (
    <ViewShell.Root
      resizable
      main={{ width: listWidth(), min: 340, max: 720 }}
      detail={{ initialWidth: 'auto', min: 440, max: 4000, whenNarrow: 'hide' }}
      detailOpen
    >
      <ViewShell.Aside>Navigation</ViewShell.Aside>
      <Panes />
    </ViewShell.Root>
  ));
  const panelWidth = (slot: 'aside' | 'main' | 'detail') => {
    const panel = view.container.querySelector<HTMLElement>(
      `[data-view-shell-${slot}]`
    )?.parentElement;
    return panel ? Number.parseFloat(panel.style.width) : undefined;
  };
  const widths = () => ({
    aside: panelWidth('aside'),
    main: panelWidth('main'),
    detail: panelWidth('detail'),
  });
  const dragListDivider = (from: number, to: number) => {
    const [, listDivider] = view.getAllByRole('separator');
    fireEvent(
      listDivider,
      new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: from })
    );
    fireEvent(window, new MouseEvent('pointermove', { clientX: to }));
    fireEvent(window, new MouseEvent('pointerup', { clientX: to }));
  };

  return { widths, dragListDivider, setShellWidth, listWidth };
}

it('opens Main at its width and gives the detail the rest', () => {
  const view = setup({ shellWidth: 1600, listWidth: 600 });
  expect(view.widths()).toEqual({ aside: 256, main: 600, detail: 742 });
});

it('holds the width while the shell resizes', () => {
  const view = setup({ shellWidth: 1600, listWidth: 600 });

  view.setShellWidth(1900);
  expect(view.widths()).toEqual({ aside: 256, main: 600, detail: 1042 });

  view.setShellWidth(1400);
  expect(view.widths()).toEqual({ aside: 256, main: 600, detail: 542 });
});

it('holds a dragged width once the caller stores it', () => {
  const view = setup({ shellWidth: 1600, listWidth: 600 });

  view.dragListDivider(857, 817);
  expect(view.listWidth()).toBe(560);
  expect(view.widths()).toEqual({ aside: 256, main: 560, detail: 782 });

  view.setShellWidth(1900);
  expect(view.widths()).toEqual({ aside: 256, main: 560, detail: 1082 });
});

it('gives way before the aside in a tight shell, then returns', () => {
  const view = setup({ shellWidth: 1600, listWidth: 600 });

  view.setShellWidth(1200);
  expect(view.widths()).toEqual({ aside: 256, main: 502, detail: 440 });

  view.setShellWidth(1020);
  expect(view.widths()).toEqual({ aside: 238, main: 340, detail: 440 });

  view.setShellWidth(1000);
  expect(view.widths().detail).toBeUndefined();

  view.setShellWidth(1600);
  expect(view.widths()).toEqual({ aside: 256, main: 600, detail: 742 });
});
