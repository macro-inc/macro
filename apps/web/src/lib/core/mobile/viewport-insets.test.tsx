import { FloatRegionHost } from '@components/app/mobile/float-regions/FloatRegionHost';
import { cleanup, render } from '@solidjs/testing-library';
import { createResource, createRoot, Suspense } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  followContentInsetBottom,
  followKeyboardViewport,
  followViewportHeight,
  NoContentInsetBottomProvider,
  publishContentInsetBottom,
  publishKeyboardViewport,
} from './viewport-insets';

const INSET = '--mobile-content-inset-bottom';

/** Runs `follow` on a new element under its own owner. */
function mount(follow: (element: HTMLElement) => void) {
  return createRoot((dispose) => {
    const element = document.createElement('div');
    follow(element);
    return { element, dispose };
  });
}

/** Whether <html> has any inline style at all. */
const rootStyle = () => document.documentElement.getAttribute('style') ?? '';

beforeEach(() => {
  document.documentElement.removeAttribute('style');
});

afterEach(() => {
  cleanup();
  publishContentInsetBottom(undefined);
  publishKeyboardViewport(undefined);
  vi.unstubAllGlobals();
});

describe('followContentInsetBottom', () => {
  it('writes the current value on a follower that mounts after a publish', () => {
    publishContentInsetBottom(80);
    const { element, dispose } = mount(followContentInsetBottom);
    expect(element.style.getPropertyValue(INSET)).toBe('80px');
    dispose();
  });

  it('updates a follower that mounted first, in the same task as the publish', () => {
    const { element, dispose } = mount(followContentInsetBottom);
    expect(element.style.getPropertyValue(INSET)).toBe('');
    publishContentInsetBottom(80);
    expect(element.style.getPropertyValue(INSET)).toBe('80px');
    publishContentInsetBottom(120);
    expect(element.style.getPropertyValue(INSET)).toBe('120px');
    publishContentInsetBottom(undefined);
    expect(element.style.getPropertyValue(INSET)).toBe('');
    dispose();
  });

  it('removes the value when its owner is disposed', () => {
    publishContentInsetBottom(80);
    const { element, dispose } = mount(followContentInsetBottom);
    dispose();
    expect(element.style.getPropertyValue(INSET)).toBe('');
    publishContentInsetBottom(120);
    expect(element.style.getPropertyValue(INSET)).toBe('');
  });

  it('leaves the value unset under NoContentInsetBottomProvider', () => {
    publishContentInsetBottom(80);
    let element!: HTMLElement;
    render(() => (
      <NoContentInsetBottomProvider value>
        <div
          ref={(el) => {
            element = el;
            followContentInsetBottom(el);
          }}
        />
      </NoContentInsetBottomProvider>
    ));
    expect(element.style.getPropertyValue(INSET)).toBe('');
  });

  it('writes while a Suspense boundary holds its content back', () => {
    publishContentInsetBottom(80);
    let element!: HTMLElement;
    render(() => {
      const [pending] = createResource(() => new Promise<string>(() => {}));
      return (
        <Suspense>
          <div
            ref={(el) => {
              element = el;
              followContentInsetBottom(el);
            }}
          />
          {pending()}
        </Suspense>
      );
    });
    // createEffect would wait for the boundary to resolve.
    expect(element.style.getPropertyValue(INSET)).toBe('80px');
  });
});

describe('followKeyboardViewport and followViewportHeight', () => {
  it('lets several followers share one element', () => {
    const element = document.createElement('div');
    const dispose = createRoot((disposeRoot) => {
      followKeyboardViewport(element);
      followViewportHeight(element);
      followContentInsetBottom(element);
      return disposeRoot;
    });
    publishKeyboardViewport({ dvh: '3px', keyboardHeight: 300 });
    publishContentInsetBottom(80);
    expect(element.style.getPropertyValue('--dvh')).toBe('3px');
    expect(element.style.getPropertyValue('--virtual-keyboard-height')).toBe(
      '300px'
    );
    expect(element.style.height).toBe('calc(300px)');
    expect(element.style.getPropertyValue(INSET)).toBe('80px');
    dispose();
    expect(element.getAttribute('style') ?? '').toBe('');
  });

  it('writes the frame height directly and clears it with the keyboard', () => {
    const { element, dispose } = mount(followViewportHeight);
    publishKeyboardViewport({ dvh: '1dvh', keyboardHeight: 0 });
    expect(element.style.height).toBe('calc(100dvh)');
    publishKeyboardViewport(undefined);
    expect(element.style.height).toBe('');
    dispose();
  });
});

describe('<html>', () => {
  it('never gets any of the values', () => {
    const { dispose } = mount((element) => {
      followContentInsetBottom(element);
      followKeyboardViewport(element);
      followViewportHeight(element);
    });
    publishContentInsetBottom(80);
    publishKeyboardViewport({ dvh: '3px', keyboardHeight: 300 });
    publishKeyboardViewport(undefined);
    dispose();
    expect(rootStyle()).toBe('');
  });

  it('is not where the float region host publishes its height', () => {
    let deliver: (() => void) | undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          deliver = () => {
            const host = document.querySelector(
              '[data-float-region]'
            )?.parentElement;
            if (host)
              callback(
                [{ target: host } as unknown as ResizeObserverEntry],
                this
              );
          };
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
    let content!: HTMLElement;
    render(() => (
      <>
        <div
          ref={(el) => {
            content = el;
            followContentInsetBottom(el);
          }}
        />
        <FloatRegionHost />
      </>
    ));
    const host = document.querySelector('[data-float-region]')!.parentElement!;
    host.getBoundingClientRect = () => ({ height: 96, width: 390 }) as DOMRect;
    deliver?.();
    expect(content.style.getPropertyValue(INSET)).toBe('96px');
    expect(rootStyle()).not.toContain('--');
  });
});
