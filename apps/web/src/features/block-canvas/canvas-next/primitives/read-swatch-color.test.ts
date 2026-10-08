import { afterEach, expect, it, vi } from 'vitest';
import { readSwatchColor } from './read-swatch-color';

afterEach(() => vi.restoreAllMocks());

it('reads ordinary RGB swatches without allocating a drawing context', () => {
  const element = document.createElement('span');
  element.style.backgroundColor = 'rgb(51, 102, 153)';
  document.body.append(element);
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext');
  expect(readSwatchColor(element)).toBe('#336699');
  expect(getContext).not.toHaveBeenCalled();
  element.remove();
});

it('uses browser rendering for theme colors and retains alpha', () => {
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    backgroundColor: 'oklch(0.6 0.1 240)',
  } as CSSStyleDeclaration);
  const fillRect = vi.fn();
  const context = {
    fillStyle: '',
    fillRect,
    getImageData: () => ({ data: new Uint8ClampedArray([51, 102, 153, 128]) }),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D
  );
  expect(readSwatchColor(document.createElement('span'))).toBe('#33669980');
  expect(context.fillStyle).toBe('oklch(0.6 0.1 240)');
  expect(fillRect).toHaveBeenCalledWith(0, 0, 1, 1);
});

it('keeps a safe picker color if the browser cannot sample the swatch', () => {
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    backgroundColor: 'color(display-p3 1 0 0)',
  } as CSSStyleDeclaration);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
    throw new Error('Unavailable');
  });
  expect(readSwatchColor(document.createElement('span'), '#336699')).toBe(
    '#336699'
  );
});
