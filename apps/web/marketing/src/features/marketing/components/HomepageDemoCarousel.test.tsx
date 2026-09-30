import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HomepageDemoCarousel } from './HomepageDemoCarousel';

let frame: HTMLIFrameElement;
let openView = vi.fn<(label: string | null) => void>();
beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  frame = document.createElement('iframe');
  document.body.append(frame);
  frame.contentDocument!.body.innerHTML = `<div class="dummy-rail">${['Home', 'Chat', 'Drive', 'Tasks', 'Customers', 'Agents'].map((label) => `<button aria-label="${label}">${label}</button>`).join('')}</div><div class="dummy-sidebar"><button>Next steps for our team</button><button>Fix the deploy pipeline</button></div>`;
  openView = vi.fn();
  frame.contentDocument!.querySelectorAll('button').forEach((button) => {
    button.addEventListener('click', () => openView(button.textContent));
  });
});
afterEach(() => {
  cleanup();
  frame.remove();
  vi.unstubAllGlobals();
});
function mountCarousel() {
  return render(() => <HomepageDemoCarousel frame={() => frame} />);
}
it('starts with the unified Home example and wraps the highlights with keyboard navigation', () => {
  mountCarousel();
  expect(openView.mock.calls.map((call) => call[0])).toEqual([
    'Home',
    'Next steps for our team',
  ]);
  fireEvent.click(screen.getByRole('button', { name: 'Previous highlight' }));
  expect(
    screen
      .getByRole('button', { name: 'Show Agents highlight' })
      .getAttribute('aria-pressed')
  ).toBe('true');
  expect(openView).toHaveBeenLastCalledWith('Fix the deploy pipeline');
  fireEvent.keyDown(screen.getByRole('button', { name: 'Next highlight' }), {
    key: 'ArrowRight',
  });
  expect(screen.getByRole('heading').textContent).toContain('One inbox');
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
    'Agents are first-class participants'
  );
  view.unmount();
  openView.mockClear();
  fireEvent.load(frame);
  expect(openView).not.toHaveBeenCalled();
});
