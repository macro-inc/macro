import { createRoot } from 'solid-js';
import { spread } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDesktopPrintShortcut } from './desktop-print-shortcut';

const { isDesktopPlatform } = vi.hoisted(() => ({
  isDesktopPlatform: vi.fn(() => true),
}));

vi.mock('@core/util/platform', () => ({ isDesktopPlatform }));

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  isDesktopPlatform.mockReturnValue(true);
});

function mount() {
  createRoot((cleanup) => {
    dispose = cleanup;
    useDesktopPrintShortcut();
  });
}

describe('desktop print shortcut', () => {
  it.each([{ ctrlKey: true }, { metaKey: true }])(
    'prevents native printing with %o, including in inputs',
    (modifiers) => {
      mount();
      const input = document.createElement('input');
      document.body.append(input);
      input.focus();
      const event = new KeyboardEvent('keydown', {
        key: 'p',
        ...modifiers,
        bubbles: true,
        cancelable: true,
      });

      input.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
    }
  );

  it('prevents native printing from the P key on non-Latin layouts', () => {
    mount();
    const event = new KeyboardEvent('keydown', {
      key: 'з',
      code: 'KeyP',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });

    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it.each([
    { key: 'p' },
    { key: 'k', ctrlKey: true },
    { key: 'p', ctrlKey: true, altKey: true },
    { key: 'p', metaKey: true, shiftKey: true },
  ])('leaves other keys and shortcuts unchanged: %o', (init) => {
    mount();
    const event = new KeyboardEvent('keydown', {
      ...init,
      bubbles: true,
      cancelable: true,
    });

    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it('leaves browser and native mobile printing unchanged', () => {
    isDesktopPlatform.mockReturnValue(false);
    mount();
    const event = new KeyboardEvent('keydown', {
      key: 'p',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });

    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it('lets a focused block handle printing before the fallback', () => {
    mount();
    const block = document.createElement('div');
    document.body.append(block);
    const print = vi.fn((event: KeyboardEvent) => {
      expect(event.defaultPrevented).toBe(false);
      event.preventDefault();
    });
    block.addEventListener('keydown', print);
    const event = new KeyboardEvent('keydown', {
      key: 'p',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });

    block.dispatchEvent(event);

    expect(print).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it('keeps propagation available to document print handlers', () => {
    mount();
    const print = vi.fn((event: KeyboardEvent) => {
      expect(event.defaultPrevented).toBe(false);
      event.preventDefault();
    });
    document.addEventListener('keydown', print, { once: true });
    const event = new KeyboardEvent('keydown', {
      key: 'p',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });

    document.dispatchEvent(event);

    expect(print).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it('removes the fallback when the app shell unmounts', () => {
    mount();
    dispose?.();
    const event = new KeyboardEvent('keydown', {
      key: 'p',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });

    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it.each(['target', 'ancestor'])(
    'prevents native printing when the %s stops propagation',
    (boundary) => {
      const ancestor = document.createElement('div');
      const input = document.createElement('input');
      ancestor.append(input);
      document.body.append(ancestor);
      const isolated = boundary === 'target' ? input : ancestor;
      isolated.addEventListener('keydown', (event) => event.stopPropagation());
      mount();

      for (let i = 0; i < 2; i++) {
        const event = new KeyboardEvent('keydown', {
          key: 'p',
          ctrlKey: true,
          repeat: i > 0,
          bubbles: true,
          cancelable: true,
        });
        input.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
      }
    }
  );

  it('preserves a print action that stops propagation', () => {
    const input = document.createElement('input');
    document.body.append(input);
    const print = vi.fn((event: KeyboardEvent) => {
      expect(event.defaultPrevented).toBe(false);
      event.preventDefault();
      event.stopPropagation();
    });
    input.addEventListener('keydown', print);
    mount();
    const event = new KeyboardEvent('keydown', {
      key: 'p',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    const preventDefault = vi.spyOn(event, 'preventDefault');

    input.dispatchEvent(event);

    expect(print).toHaveBeenCalledOnce();
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it('aborts pending fallbacks if the shell unmounts during key handling', () => {
    const input = document.createElement('input');
    document.body.append(input);
    input.addEventListener('keydown', () => dispose?.());
    mount();
    const event = new KeyboardEvent('keydown', {
      key: 'p',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });

    input.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it.each([false, true])(
    'handles Solid delegated inputs when propagation is stopped: %s',
    (stopPropagation) => {
      const input = document.createElement('input');
      document.body.append(input);
      createRoot((cleanup) => {
        dispose = cleanup;
        spread(input, {
          onKeyDown: (event: KeyboardEvent) => {
            if (stopPropagation) event.stopPropagation();
          },
        });
        useDesktopPrintShortcut();
      });
      const event = new KeyboardEvent('keydown', {
        key: 'p',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });

      input.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
    }
  );
});
