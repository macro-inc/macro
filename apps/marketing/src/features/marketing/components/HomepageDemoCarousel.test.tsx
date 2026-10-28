import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HomepageDemoCarousel } from './HomepageDemoCarousel';

let frame: HTMLIFrameElement;
let openView = vi.fn<(label: string | null) => void>();
beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  frame = document.createElement('iframe');
  document.body.append(frame);
  frame.contentDocument!.body.innerHTML = `<div class="dummy-rail">${['Home', 'Chat', 'Drive', 'Tasks', 'Customers', 'Agents'].map((label) => `<button aria-label="${label}">${label}</button>`).join('')}</div><div class="dummy-sidebar"><button>Homepage feedback</button><button data-agent-session-row="deploy">Fix the deploy pipeline<span>12m · PR #482</span></button></div>`;
  openView = vi.fn();
  frame.contentDocument!.querySelectorAll('button').forEach((button) => {
    button.addEventListener('click', () =>
      openView(
        button.getAttribute('data-agent-session-row') ?? button.textContent
      )
    );
  });
});
afterEach(() => {
  cleanup();
  frame.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function mountCarousel() {
  return render(() => <HomepageDemoCarousel frame={() => frame} />);
}
it('starts with the unified Home example and wraps the highlights with keyboard navigation', () => {
  mountCarousel();
  expect(openView.mock.calls.map((call) => call[0])).toEqual([
    'Home',
    'Homepage feedback',
  ]);
  fireEvent.click(screen.getByRole('button', { name: 'Previous highlight' }));
  expect(
    screen
      .getByRole('button', { name: 'Show Agents highlight' })
      .getAttribute('aria-pressed')
  ).toBe('true');
  expect(openView).toHaveBeenLastCalledWith('deploy');
  fireEvent.keyDown(screen.getByRole('button', { name: 'Next highlight' }), {
    key: 'ArrowRight',
  });
  expect(screen.getByRole('heading').textContent).toContain(
    'One inbox for emails, agents,\ntasks, and messages'
  );
});
it('keeps the carousel in place during iframe interaction and cleans up load listeners', () => {
  const view = mountCarousel();
  const heading = screen.getByRole('heading');
  frame.contentDocument!.dispatchEvent(
    new Event('pointerdown', { bubbles: true })
  );
  frame.contentDocument!.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'a', bubbles: true })
  );
  expect(screen.getByRole('heading')).toBe(heading);
  expect(screen.getByRole('button', { name: 'Next highlight' })).toBeTruthy();
  expect(screen.queryByText('Back to highlights')).toBeNull();
  expect(document.querySelector('iframe')).toBe(frame);
  frame
    .contentDocument!.querySelector<HTMLButtonElement>('[aria-label=Chat]')!
    .click();
  expect(screen.getByRole('heading').textContent).toContain(
    'Agents are first-class participants\nin channels and DMs'
  );
  view.unmount();
  openView.mockClear();
  fireEvent.load(frame);
  expect(openView).not.toHaveBeenCalled();
});

it('captures horizontal drags and ignores vertical or cancelled gestures', () => {
  mountCarousel();
  const pointer = (
    type: string,
    target: Element,
    values: { clientX: number; clientY: number }
  ) => {
    const event = new MouseEvent(type, { bubbles: true, button: 0, ...values });
    Object.defineProperties(event, {
      pointerId: { value: 1 },
      isPrimary: { value: true },
    });
    fireEvent(target, event);
  };
  const carousel = screen.getByRole('region');
  const capture = vi.fn();
  carousel.setPointerCapture = capture;
  const down = {
    pointerId: 1,
    isPrimary: true,
    button: 0,
    clientX: 300,
    clientY: 100,
  };
  pointer('pointerdown', screen.getByRole('heading'), down);
  expect(capture).toHaveBeenCalledWith(1);
  pointer('pointerup', carousel, { ...down, clientX: 200 });
  expect(screen.getByRole('heading').textContent).toContain(
    'Agents are first-class participants\nin channels and DMs'
  );

  pointer('pointerdown', carousel, down);
  pointer('pointerup', carousel, { ...down, clientX: 400 });
  expect(screen.getByRole('heading').textContent).toContain(
    'One inbox for emails, agents,\ntasks, and messages'
  );

  pointer('pointerdown', carousel, down);
  pointer('pointerup', carousel, { ...down, clientX: 200, clientY: 250 });
  expect(screen.getByRole('heading').textContent).toContain(
    'One inbox for emails, agents,\ntasks, and messages'
  );

  pointer('pointerdown', carousel, down);
  pointer('pointercancel', carousel, down);
  pointer('pointerup', carousel, { ...down, clientX: 200 });
  expect(screen.getByRole('heading').textContent).toContain(
    'One inbox for emails, agents,\ntasks, and messages'
  );
});

function enableAutoplay() {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  frame.animate = vi.fn(() => ({ cancel() {} }) as Animation);
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(private callback: IntersectionObserverCallback) {}
      observe(target: Element) {
        this.callback(
          [
            {
              target,
              isIntersecting: true,
              intersectionRatio: 1,
            } as IntersectionObserverEntry,
          ],
          this as unknown as IntersectionObserver
        );
      }
      disconnect() {}
    }
  );
}

it('keeps the selected highlight stable for reduced motion', () => {
  vi.useFakeTimers();
  mountCarousel();
  vi.advanceTimersByTime(24000);
  expect(openView.mock.calls.map((call) => call[0])).toEqual([
    'Home',
    'Homepage feedback',
  ]);
  expect(screen.queryByRole('button', { name: 'Pause slideshow' })).toBeNull();
});

it('keeps the selected highlight stable without reduced motion', () => {
  enableAutoplay();
  mountCarousel();
  fireEvent.click(screen.getByRole('button', { name: 'Next highlight' }));
  expect(openView).toHaveBeenLastCalledWith('Chat');
  openView.mockClear();
  vi.advanceTimersByTime(24000);
  expect(openView).not.toHaveBeenCalled();
});

it('does not advance after entering or replaying the sample workspace', () => {
  enableAutoplay();
  mountCarousel();
  fireEvent(
    screen.getByRole('region'),
    new CustomEvent('macro-demo-interaction', { bubbles: true })
  );
  fireEvent(
    screen.getByRole('region'),
    new CustomEvent('macro-demo-replay', { bubbles: true })
  );
  openView.mockClear();
  vi.advanceTimersByTime(30000);
  expect(openView).not.toHaveBeenCalled();
});

it('handles page arrow keys without focusing an arrow and releases the listener on unmount', () => {
  const view = mountCarousel();
  fireEvent.keyDown(document.body, { key: 'ArrowRight' });
  expect(openView).toHaveBeenLastCalledWith('Chat');
  fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
  expect(openView).toHaveBeenLastCalledWith('Homepage feedback');
  view.unmount();
  openView.mockClear();
  fireEvent.keyDown(document.body, { key: 'ArrowRight' });
  expect(openView).not.toHaveBeenCalled();
});

it('leaves arrows with editors, other controls, dialogs, and the embedded workspace', () => {
  mountCarousel();
  const container = document.createElement('div');
  container.innerHTML =
    '<input /><textarea></textarea><div contenteditable="true"><span>Editor</span></div><button>Other carousel</button><div role="slider" tabindex="0"></div>';
  document.body.append(container);
  openView.mockClear();
  for (const target of container.querySelectorAll(
    'input, textarea, span, button, [role="slider"]'
  )) {
    expect(fireEvent.keyDown(target, { key: 'ArrowRight' })).toBe(true);
  }
  fireEvent.keyDown(frame.contentDocument!.body, { key: 'ArrowRight' });
  for (const options of [
    { metaKey: true },
    { ctrlKey: true },
    { altKey: true },
    { shiftKey: true },
    { isComposing: true },
    { repeat: true },
  ]) {
    fireEvent.keyDown(document.body, { key: 'ArrowRight', ...options });
  }
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  container.append(dialog);
  fireEvent.keyDown(document.body, { key: 'ArrowRight' });
  expect(openView).not.toHaveBeenCalled();
  container.remove();
});

it('ignores page arrow keys when the demo is out of view', () => {
  let visibility: IntersectionObserverCallback | undefined;
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(
        callback: IntersectionObserverCallback,
        options: IntersectionObserverInit
      ) {
        if (!options.rootMargin) visibility = callback;
      }
      observe() {}
      disconnect() {}
    }
  );
  mountCarousel();
  openView.mockClear();
  fireEvent.keyDown(document.body, { key: 'ArrowRight' });
  expect(openView).not.toHaveBeenCalled();
  visibility?.(
    [
      {
        isIntersecting: true,
        intersectionRatio: 0.5,
      } as IntersectionObserverEntry,
    ],
    {} as IntersectionObserver
  );
  fireEvent.keyDown(document.body, { key: 'ArrowRight' });
  expect(openView).toHaveBeenLastCalledWith('Chat');
  visibility?.(
    [
      {
        isIntersecting: false,
        intersectionRatio: 0,
      } as IntersectionObserverEntry,
    ],
    {} as IntersectionObserver
  );
  openView.mockClear();
  fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
  expect(openView).not.toHaveBeenCalled();
});

it('does not restart automatic cycling after keyboard focus leaves the demo', () => {
  enableAutoplay();
  mountCarousel();
  const next = screen.getByRole('button', { name: 'Next highlight' });
  fireEvent.focusIn(next);
  fireEvent.focusOut(next, { relatedTarget: document.body });
  openView.mockClear();
  vi.advanceTimersByTime(60000);
  expect(openView).not.toHaveBeenCalled();
});

it('opens the email in the mixed Home feed using the current fixture title', () => {
  const email = frame.contentDocument!.querySelector<HTMLButtonElement>(
    '.dummy-sidebar button'
  )!;
  const openEmail = vi.fn();
  email.addEventListener('click', openEmail);
  mountCarousel();
  expect(openEmail).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Next highlight' }));
  fireEvent.click(screen.getByRole('button', { name: 'Previous highlight' }));
  expect(openEmail).toHaveBeenCalledTimes(2);
});
