import { fireEvent, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { ViewShell } from './ViewShell';

const measurement = vi.hoisted(() => ({ width: () => 1200 }));

vi.mock('@solid-primitives/resize-observer', () => ({
  createElementSize: () => ({
    get width() {
      return measurement.width();
    },
    height: 800,
  }),
}));

vi.mock('@ui', async () => import('../ui/utils/classname'));

function setup(preserveDuringResize: boolean) {
  const [width, setWidth] = createSignal(1200);
  const [configuredWidth, setConfiguredWidth] = createSignal(256);
  measurement.width = width;
  const onWidthChangeEnd = vi.fn();
  const view = render(() => (
    <ViewShell.Root
      resizable
      aside={{ width: configuredWidth(), preserveDuringResize }}
      main={{ preferredWidth: 640 }}
    >
      <ViewShell.Aside onWidthChangeEnd={onWidthChangeEnd} />
      <ViewShell.Main />
    </ViewShell.Root>
  ));
  const aside = view.container.querySelector('[data-view-shell-aside]')!
    .parentElement!;
  const asideWidth = () => Number.parseFloat(aside.style.width);
  const growAside = async () => {
    fireEvent.keyDown(view.getByRole('separator'), { key: 'ArrowRight' });
    await Promise.resolve();
  };
  const dragAside = () => {
    fireEvent(
      view.getByRole('separator'),
      new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 256 })
    );
    fireEvent(window, new MouseEvent('pointermove', { clientX: 296 }));
    fireEvent(window, new MouseEvent('pointerup'));
  };
  return {
    ...view,
    asideWidth,
    growAside,
    dragAside,
    setWidth,
    setConfiguredWidth,
    onWidthChangeEnd,
  };
}

describe('ViewShell aside resize preference', () => {
  it('remembers the width after a pointer drag', () => {
    const view = setup(true);
    view.dragAside();
    expect(view.asideWidth()).toBeCloseTo(296);
    view.setWidth(1100);
    expect(view.asideWidth()).toBeCloseTo(296);
    expect(view.onWidthChangeEnd).toHaveBeenCalledOnce();
  });

  it.each([true, false])(
    'keeps the chosen width when the containing split resizes (preserve=%s)',
    async (preserve) => {
      const view = setup(preserve);
      expect(view.asideWidth()).toBeCloseTo(256);
      await view.growAside();
      expect(view.asideWidth()).toBeCloseTo(276);
      expect(view.onWidthChangeEnd).toHaveBeenCalledOnce();
      expect(view.onWidthChangeEnd.mock.calls[0][0]).toBeCloseTo(276);
      view.setWidth(1100);
      expect(view.asideWidth()).toBeCloseTo(276);
      view.setWidth(1400);
      expect(view.asideWidth()).toBeCloseTo(276);
      expect(view.onWidthChangeEnd).toHaveBeenCalledOnce();
    }
  );

  it('yields to the main preference, then restores the chosen width', async () => {
    const view = setup(false);
    await view.growAside();
    view.setWidth(890);
    expect(view.asideWidth()).toBeCloseTo(249);
    view.setWidth(1200);
    expect(view.asideWidth()).toBeCloseTo(276);
    view.setWidth(700);
    view.setWidth(1200);
    expect(view.asideWidth()).toBeCloseTo(276);
  });

  it('honors a new configured width after a manual resize', async () => {
    const view = setup(true);
    await view.growAside();
    view.setConfiguredWidth(300);
    expect(view.asideWidth()).toBeCloseTo(300);
    view.setWidth(1100);
    expect(view.asideWidth()).toBeCloseTo(300);
  });
});
