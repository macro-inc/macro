import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { expect, it } from 'vitest';
import type { Camera } from '../src/core/model';
import { DotGrid } from '../src/solid/dot-grid-view';

it('keeps one-pixel marks anchored during fractional zoom and isolates multiple canvases', () => {
  const [camera, setCamera] = createSignal<Camera>({ x: 0, y: 0, scale: 1 });
  const [color, setColor] = createSignal('var(--color-edge)');
  const host = document.createElement('div');
  const dispose = render(
    () => (
      <>
        <DotGrid camera={camera()} color={color()} />
        <DotGrid camera={{ x: 0, y: 0, scale: 1 }} color="currentColor" />
      </>
    ),
    host
  );
  const grids = host.querySelectorAll('[data-graphics-grid]');
  const patterns = [...host.querySelectorAll('pattern')];
  expect(new Set(patterns.map((pattern) => pattern.id)).size).toBe(6);
  for (const grid of grids) {
    for (const fill of grid.querySelectorAll('rect[fill^="url"]')) {
      const reference = fill.getAttribute('fill')!.slice(5, -1);
      expect(
        [...grid.querySelectorAll('pattern')].some(
          (pattern) => pattern.id === reference
        )
      ).toBe(true);
    }
  }
  const second = grids[1]!.innerHTML;
  for (const scale of [8, 7.3848947, 4.001, 3.999, 0.01]) {
    setCamera({ x: -39.5, y: 17.25, scale });
    const live = [...grids[0]!.querySelectorAll('pattern')];
    live.forEach((pattern, i) => {
      expect(pattern).toBe(patterns[i]);
      expect(Number(pattern.getAttribute('x')) + 0.5).toBe(-39.5);
      expect(Number(pattern.getAttribute('y')) + 0.5).toBe(17.25);
      const dot = pattern.firstElementChild!;
      expect(dot.getAttribute('width')).toBe('1');
      expect(dot.getAttribute('height')).toBe('1');
    });
    expect(grids[1]!.innerHTML).toBe(second);
  }
  setColor('transparent');
  expect(
    [...grids[0]!.querySelectorAll('pattern rect')].every(
      (dot) => dot.getAttribute('fill') === 'transparent'
    )
  ).toBe(true);
  dispose();
});
