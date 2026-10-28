import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComposerSurface } from './ComposerSurface';

const device = vi.hoisted(() => ({ touch: false }));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => device.touch,
}));

beforeEach(() => {
  device.touch = false;
});
afterEach(cleanup);

describe('ComposerSurface', () => {
  it.each([false, true])(
    'retains the default panel structure with touch=%s',
    (touch) => {
      device.touch = touch;
      let root: HTMLDivElement | undefined;
      const { container } = render(() => (
        <ComposerSurface ref={(element) => (root = element)}>
          <input aria-label="Message" />
        </ComposerSurface>
      ));

      expect(container.querySelector('[data-surface]')).toBe(root);
      expect(root?.parentElement?.getAttribute('data-depth')).toBe(
        touch ? '3' : '2'
      );
      expect(root?.style.border).toBe('');
      expect(root?.classList.contains('bg-composer')).toBe(!touch);
      expect(screen.getByRole('textbox').parentElement).toBe(root);
    }
  );

  it.each([false, true])(
    'composes a native root without changing focus or adding panel behavior with touch=%s',
    (touch) => {
      device.touch = touch;
      const [className, setClassName] = createSignal('p-4');
      const clicked = vi.fn();
      let root: HTMLDivElement | undefined;
      const { container } = render(() => (
        <ComposerSurface
          as="div"
          ref={(element) => (root = element)}
          class={className()}
          data-message-body-id="message-1"
          onClick={clicked}
        >
          <input aria-label="Message" />
        </ComposerSurface>
      ));

      expect(container.firstElementChild).toBe(root);
      expect(
        container.querySelector('[data-layer], [data-surface]')
      ).toBeNull();
      expect(root?.classList.contains('overflow-clip')).toBe(false);
      expect(root?.classList.contains('touch:island')).toBe(false);
      expect(root?.classList.contains('bg-composer')).toBe(!touch);
      expect(root?.getAttribute('data-message-body-id')).toBe('message-1');
      const input = screen.getByRole('textbox') as HTMLInputElement;
      input.value = 'Unsent draft';
      input.focus();

      setClassName('p-6');

      expect(container.firstElementChild).toBe(root);
      expect(input.parentElement).toBe(root);
      expect(document.activeElement).toBe(input);
      expect(input.value).toBe('Unsent draft');
      expect(root?.classList.contains('bg-composer')).toBe(!touch);
      expect(root?.classList.contains('p-6')).toBe(true);
      fireEvent.click(input);
      expect(clicked).toHaveBeenCalledTimes(1);
    }
  );
});
