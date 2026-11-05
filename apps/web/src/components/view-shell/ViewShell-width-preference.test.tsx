import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useViewShell, ViewShell } from './ViewShell';
import type { AsideLayout } from './view-shell-layout';

const measurement = vi.hoisted(() => ({ width: (): number => 1200 }));

vi.mock('@core/hotkey/hotkeys', () => ({ registerHotkey: vi.fn() }));
vi.mock('./create-frame-width', () => ({
  createFrameWidth: () => () => measurement.width(),
}));
vi.mock('@solid-primitives/resize-observer', () => ({
  createResizeObserver: () => {},
  createElementSize: () => ({
    get width() {
      return measurement.width();
    },
    height: 800,
  }),
}));

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  measurement.width = () => 1200;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Workspace(props: {
  app?: string;
  aside?: Partial<AsideLayout>;
  onWidthChangeEnd?: (width: number) => void;
  detailOpen?: boolean;
}) {
  function Controls() {
    const shell = useViewShell();
    return (
      <>
        <button type="button" onClick={shell.aside.collapse}>
          Hide navigation
        </button>
        <button type="button" onClick={shell.aside.expand}>
          Show navigation
        </button>
      </>
    );
  }
  return (
    <ViewShell.Root
      asidePreferenceKey={props.app}
      aside={{ preserveDuringResize: false, ...props.aside }}
      main={{ preferredWidth: 640 }}
      detailOpen={props.detailOpen}
      resizable
    >
      <ViewShell.Aside onWidthChangeEnd={props.onWidthChangeEnd}>
        Navigation
      </ViewShell.Aside>
      <ViewShell.Main>
        <Controls />
      </ViewShell.Main>
      <ViewShell.Detail>Details</ViewShell.Detail>
    </ViewShell.Root>
  );
}

describe('ViewShell persisted sidebar width', () => {
  it.each(['home', 'tasks', 'email', 'documents', 'calendar', 'agents'])(
    'restores the %s sidebar width after a remount without changing other views',
    (app) => {
      const first = render(() => <Workspace app={app} />);
      const separator = first.getByRole('separator');
      fireEvent(
        separator,
        new MouseEvent('pointerdown', {
          bubbles: true,
          button: 0,
          clientX: 256,
        })
      );
      fireEvent(window, new MouseEvent('pointermove', { clientX: 296 }));
      fireEvent(window, new MouseEvent('pointerup', { clientX: 296 }));
      expect(
        first.container.querySelector('[data-view-shell-aside]')?.parentElement
          ?.style.width
      ).toBe('296px');
      first.unmount();

      const second = render(() => <Workspace app={app} />);
      expect(
        second.container.querySelector('[data-view-shell-aside]')?.parentElement
          ?.style.width
      ).toBe('296px');
      second.unmount();

      const other = render(() => <Workspace app="reviews" />);
      expect(
        other.container.querySelector('[data-view-shell-aside]')?.parentElement
          ?.style.width
      ).toBe('256px');
    }
  );

  it('keeps keyboard-resized width through constrained layouts, overlays, and remounts', async () => {
    const [width, setWidth] = createSignal(1200);
    measurement.width = width;
    const first = render(() => <Workspace app="tasks" />);
    fireEvent.keyDown(first.getByRole('separator'), { key: 'ArrowRight' });
    await Promise.resolve();
    expect(
      first.container.querySelector('[data-view-shell-aside]')?.parentElement
        ?.style.width
    ).toBe('276px');

    setWidth(800);
    setWidth(600);
    fireEvent.click(first.getByRole('button', { name: 'Show navigation' }));
    const overlay = first.container.querySelector<HTMLElement>(
      '[data-view-shell-aside]'
    );
    expect(overlay?.style.width).toBe('276px');
    fireEvent.click(
      first.getByRole('button', { name: 'Close navigation backdrop' })
    );
    first.unmount();

    setWidth(1200);
    const second = render(() => <Workspace app="tasks" />);
    expect(
      second.container.querySelector('[data-view-shell-aside]')?.parentElement
        ?.style.width
    ).toBe('276px');
    fireEvent.click(second.getByRole('button', { name: 'Hide navigation' }));
    second.unmount();

    const third = render(() => <Workspace app="tasks" />);
    fireEvent.click(third.getByRole('button', { name: 'Show navigation' }));
    expect(
      third.container.querySelector('[data-view-shell-aside]')?.parentElement
        ?.style.width
    ).toBe('276px');
  });

  it('restores a resize made in a constrained split without restoring the old main preference', () => {
    const [width, setWidth] = createSignal(800);
    measurement.width = width;
    const first = render(() => <Workspace app="tasks" />);
    fireEvent(
      first.getByRole('separator'),
      new MouseEvent('pointerdown', {
        bubbles: true,
        button: 0,
        clientX: 224,
      })
    );
    fireEvent(window, new MouseEvent('pointermove', { clientX: 300 }));
    fireEvent(window, new MouseEvent('pointerup', { clientX: 300 }));
    expect(
      first.container.querySelector('[data-view-shell-aside]')?.parentElement
        ?.style.width
    ).toBe('300px');
    first.unmount();

    const second = render(() => <Workspace app="tasks" />);
    expect(
      second.container.querySelector('[data-view-shell-aside]')?.parentElement
        ?.style.width
    ).toBe('300px');
    setWidth(760);
    expect(
      second.container.querySelector('[data-view-shell-aside]')?.parentElement
        ?.style.width
    ).toBe('260px');
    setWidth(800);
    expect(
      second.container.querySelector('[data-view-shell-aside]')?.parentElement
        ?.style.width
    ).toBe('300px');
  });

  it('does not replace the saved sidebar width when another divider redistributes space', async () => {
    const [detailOpen, setDetailOpen] = createSignal(false);
    const first = render(() => (
      <Workspace app="tasks" detailOpen={detailOpen()} />
    ));
    fireEvent.keyDown(first.getByRole('separator'), { key: 'ArrowRight' });
    await Promise.resolve();
    expect(
      first.container.querySelector('[data-view-shell-aside]')?.parentElement
        ?.style.width
    ).toBe('276px');

    setDetailOpen(true);
    fireEvent(
      first.getByRole('separator', { name: 'resize at 1' }),
      new MouseEvent('pointerdown', {
        bubbles: true,
        button: 0,
        clientX: 800,
      })
    );
    fireEvent(window, new MouseEvent('pointermove', { clientX: 500 }));
    fireEvent(window, new MouseEvent('pointerup', { clientX: 500 }));
    expect(
      first.container.querySelector('[data-view-shell-aside]')?.parentElement
        ?.style.width
    ).toBe('238px');
    setDetailOpen(false);
    expect(
      first.container.querySelector('[data-view-shell-aside]')?.parentElement
        ?.style.width
    ).toBe('276px');
    first.unmount();

    const second = render(() => <Workspace app="tasks" />);
    expect(
      second.container.querySelector('[data-view-shell-aside]')?.parentElement
        ?.style.width
    ).toBe('276px');
  });

  it('leaves caller-owned width persistence authoritative', async () => {
    const onWidthChangeEnd = vi.fn();
    const first = render(() => (
      <Workspace
        app="channels"
        aside={{ width: 280 }}
        onWidthChangeEnd={onWidthChangeEnd}
      />
    ));
    fireEvent.keyDown(first.getByRole('separator'), { key: 'ArrowRight' });
    await Promise.resolve();
    expect(onWidthChangeEnd).toHaveBeenCalledWith(300);
    first.unmount();

    const second = render(() => (
      <Workspace
        app="channels"
        aside={{ width: 320 }}
        onWidthChangeEnd={onWidthChangeEnd}
      />
    ));
    expect(
      second.container.querySelector('[data-view-shell-aside]')?.parentElement
        ?.style.width
    ).toBe('320px');
  });

  it('does not persist an unkeyed sidebar', async () => {
    const first = render(() => <Workspace />);
    fireEvent.keyDown(first.getByRole('separator'), { key: 'ArrowRight' });
    await Promise.resolve();
    first.unmount();

    const second = render(() => <Workspace />);
    expect(
      second.container.querySelector('[data-view-shell-aside]')?.parentElement
        ?.style.width
    ).toBe('256px');
  });
});
