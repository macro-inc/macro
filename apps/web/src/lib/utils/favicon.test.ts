import { afterEach, describe, expect, it, vi } from 'vitest';
import { updateFavicon } from './favicon';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('favicon updates', () => {
  it('keeps the current icon while loading, discards stale renders, and caches repeats', () => {
    const images: Array<{ src: string; onload?: () => void }> = [];
    vi.stubGlobal(
      'Image',
      class {
        src = '';
        onload?: () => void;
        constructor() {
          images.push(this);
        }
      }
    );
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    const render = vi
      .spyOn(HTMLCanvasElement.prototype, 'toDataURL')
      .mockReturnValue('data:image/png;base64,first');
    const original = document.createElement('link');
    original.rel = 'icon';
    original.href = 'original.png';
    document.head.append(original);
    updateFavicon('red');
    expect(original.isConnected).toBe(true);
    updateFavicon('blue');
    images[0].onload?.();
    expect(drawImage).not.toHaveBeenCalled();
    images[1].onload?.();
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')!;
    expect(icon.href).toBe('data:image/png;base64,first');
    updateFavicon('blue');
    expect(images).toHaveLength(2);
    updateFavicon('green');
    expect(icon.href).toBe('data:image/png;base64,first');
    render.mockReturnValue('data:image/png;base64,second');
    images[2].onload?.();
    updateFavicon('blue');
    expect(images).toHaveLength(3);
    expect(document.querySelector('link[rel="icon"]')).toBe(icon);
    expect(icon.href).toBe('data:image/png;base64,first');
    icon.remove();
  });
});
