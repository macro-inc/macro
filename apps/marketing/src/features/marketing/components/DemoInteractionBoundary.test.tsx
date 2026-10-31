import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  DEMO_INTERACTION_EVENT,
  DemoInteractionBoundary,
  DemoInteractionScope,
} from './DemoInteractionBoundary';

beforeEach(() => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('lets preview wheel gestures pass to the page and enables controls only on entry', () => {
  const wheel = vi.fn();
  const use = vi.fn();
  const view = render(() => (
    <DemoInteractionBoundary label="workspace">
      <div onWheel={wheel}>
        <button onClick={use}>Edit item</button>
      </div>
    </DemoInteractionBoundary>
  ));
  const content = view.container.querySelector<HTMLElement>(
    '.demo-interaction-content'
  )!;
  const entry = screen.getByRole('button', { name: /Interact with workspace/ });
  const event = new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    deltaY: 300,
  });
  entry.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  expect(wheel).not.toHaveBeenCalled();
  const started = vi.fn();
  view.container.addEventListener(DEMO_INTERACTION_EVENT, started);
  fireEvent.click(entry, { detail: 1 });
  expect(content.inert).toBe(false);
  expect(started).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Edit item' }));
  expect(use).toHaveBeenCalledTimes(1);
  fireEvent.pointerDown(document.body);
  expect(content.inert).toBe(true);
});

it('uses one gate for nested demos and restores entry focus with Escape', async () => {
  const view = render(() => (
    <DemoInteractionBoundary>
      <DemoInteractionBoundary>
        <button>Inner action</button>
      </DemoInteractionBoundary>
    </DemoInteractionBoundary>
  ));
  expect(screen.getAllByRole('button', { name: /Interact with/ })).toHaveLength(
    1
  );
  fireEvent.click(screen.getByRole('button', { name: /Interact with/ }), {
    detail: 0,
  });
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Inner action' })
    )
  );
  fireEvent.keyDown(screen.getByRole('button', { name: 'Inner action' }), {
    key: 'Escape',
  });
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: /Interact with/ })
    )
  );
  view.unmount();
  render(() => (
    <DemoInteractionScope>
      <DemoInteractionBoundary>
        <button>Standalone control</button>
      </DemoInteractionBoundary>
    </DemoInteractionScope>
  ));
  expect(screen.queryByRole('button', { name: /Interact with/ })).toBeNull();
});

it('handles iframe Escape, respects inner menus, and removes frame listeners on unmount', async () => {
  const view = render(() => (
    <DemoInteractionBoundary>
      <iframe title="Sample workspace" />
    </DemoInteractionBoundary>
  ));
  const frame = view.container.querySelector('iframe')!;
  const page = frame.contentDocument!;
  fireEvent.load(frame);
  fireEvent.click(screen.getByRole('button', { name: /Interact with/ }), {
    detail: 1,
  });
  page.body.innerHTML = '<div role="menu">View options</div>';
  fireEvent.keyDown(page.body, { key: 'Escape' });
  expect(screen.queryByRole('button', { name: /Interact with/ })).toBeNull();
  page.body.innerHTML = '';
  fireEvent.keyDown(page.body, { key: 'Escape' });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /Interact with/ })).toBeTruthy()
  );
  fireEvent.click(screen.getByRole('button', { name: /Interact with/ }), {
    detail: 1,
  });
  view.unmount();
  const event = new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
  });
  page.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
});

it('recreates an abandoned demo after 30 seconds away, but never while focused or visible', async () => {
  vi.useFakeTimers();
  const observe: IntersectionObserverCallback[] = [];
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        observe.push(callback);
      }
      observe() {}
      disconnect() {}
    }
  );
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  let created = 0;
  const Scene = () => {
    created++;
    return <input aria-label="Local draft" value="Original" />;
  };
  const view = render(() => (
    <DemoInteractionBoundary render={() => <Scene />} />
  ));
  fireEvent.click(screen.getByRole('button', { name: /Interact with/ }), {
    detail: 1,
  });
  vi.advanceTimersByTime(0);
  const input = screen.getByLabelText('Local draft') as HTMLInputElement;
  input.focus();
  vi.advanceTimersByTime(0);
  fireEvent.input(input, { target: { value: 'My draft' } });
  observe[0](
    [{ isIntersecting: false } as IntersectionObserverEntry],
    {} as IntersectionObserver
  );
  await Promise.resolve();
  vi.advanceTimersByTime(40000);
  expect(input.value).toBe('My draft');
  expect(created).toBe(1);
  input.blur();
  vi.advanceTimersByTime(0);
  await Promise.resolve();
  vi.advanceTimersByTime(29999);
  expect(created).toBe(1);
  observe[0](
    [{ isIntersecting: true } as IntersectionObserverEntry],
    {} as IntersectionObserver
  );
  vi.advanceTimersByTime(40000);
  expect(created).toBe(1);
  observe[0](
    [{ isIntersecting: false } as IntersectionObserverEntry],
    {} as IntersectionObserver
  );
  vi.advanceTimersByTime(25000);
  fireEvent.pointerDown(document.body);
  vi.advanceTimersByTime(0);
  vi.advanceTimersByTime(5000);
  expect(created).toBe(2);
  expect((screen.getByLabelText('Local draft') as HTMLInputElement).value).toBe(
    'Original'
  );
  expect(view.container.querySelector('[data-demo-interacted]')).toBeNull();
  view.unmount();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('lets an inner source handle Escape before leaving the demo', () => {
  const close = vi.fn((event: KeyboardEvent) => {
    event.preventDefault();
  });
  render(() => (
    <DemoInteractionBoundary>
      <button
        onKeyDown={(event) => {
          if (event.key === 'Escape') close(event);
        }}
      >
        Close source
      </button>
    </DemoInteractionBoundary>
  ));
  fireEvent.click(screen.getByRole('button', { name: /Interact with/ }), {
    detail: 1,
  });
  fireEvent.keyDown(screen.getByRole('button', { name: 'Close source' }), {
    key: 'Escape',
  });
  expect(close).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: /Interact with/ })).toBeNull();
});

it('cancels pending idle work when the demo is removed', async () => {
  vi.useFakeTimers();
  let callback!: IntersectionObserverCallback;
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(next: IntersectionObserverCallback) {
        callback = next;
      }
      observe() {}
      disconnect() {}
    }
  );
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  const view = render(() => (
    <DemoInteractionBoundary render={() => <button>Sample</button>} />
  ));
  fireEvent.click(screen.getByRole('button', { name: /Interact with/ }), {
    detail: 1,
  });
  vi.advanceTimersByTime(0);
  callback(
    [{ isIntersecting: false } as IntersectionObserverEntry],
    {} as IntersectionObserver
  );
  fireEvent.pointerDown(document.body);
  view.unmount();
  vi.advanceTimersByTime(0);
  await Promise.resolve();
  expect(vi.getTimerCount()).toBe(0);
});
