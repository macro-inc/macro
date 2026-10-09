import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TaskContextDemo } from './TaskContextDemo';

let reduced = true;
let intersections: IntersectionObserverCallback[];
beforeEach(() => {
  reduced = true;
  intersections = [];
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersections.push(callback);
      }
      observe() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('fetch', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return reduced;
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  cleanup();
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('opens the brief from an inline task mention and restores focus on close', async () => {
  const view = render(() => <TaskContextDemo />);
  const link = view.getByRole('button', { name: 'Open Customer brief' });
  fireEvent.click(link);
  expect(
    view.getByRole('textbox', { name: 'Document body' }).textContent
  ).toContain('Update the homepage and pricing page.');
  await Promise.resolve();
  expect(document.activeElement).toBe(
    view.getByRole('button', { name: 'Close linked source' })
  );
  fireEvent.keyDown(view.getByRole('button', { name: 'Close linked source' }), {
    key: 'Escape',
  });
  expect(view.queryByRole('region', { name: 'Linked task source' })).toBeNull();
  expect(document.activeElement).toBe(link);
});

it('keeps task edits while opening the original customer email', () => {
  const view = render(() => <TaskContextDemo />);
  const description = view.getByRole('textbox', { name: 'Task description' });
  Object.defineProperty(description, 'innerText', {
    value: 'Include two pricing options.',
    configurable: true,
  });
  fireEvent.blur(description);
  fireEvent.click(view.getByRole('button', { name: 'Open Proposal request' }));
  expect(view.getByText(/Please send a proposal by Friday/)).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: 'Close linked source' }));
  expect(
    view.getByRole('textbox', { name: 'Task description' }).textContent
  ).toBe('Include two pricing options.');
});

it('opens the linked conversation and follows its document reference', () => {
  const view = render(() => <TaskContextDemo />);
  fireEvent.click(view.getByRole('button', { name: 'Open sales' }));
  expect(view.getByRole('log', { name: 'Channel sales' })).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: 'Customer brief' }));
  expect(
    view.getByRole('textbox', { name: 'Document title' }).textContent
  ).toBe('Customer brief');
});

it('preserves linked document edits and updates the task mention after a rename', () => {
  const view = render(() => <TaskContextDemo />);
  fireEvent.click(view.getByRole('button', { name: 'Open Customer brief' }));
  const title = view.getByRole('textbox', { name: 'Document title' });
  Object.defineProperty(title, 'innerText', {
    value: 'Updated customer brief',
    configurable: true,
  });
  fireEvent.blur(title);
  const body = view.getByRole('textbox', { name: 'Document body' });
  body.innerHTML = '<h2>Scope</h2><p>Include two pricing options.</p>';
  fireEvent.blur(body);
  fireEvent.click(view.getByRole('button', { name: 'Close linked source' }));
  fireEvent.click(
    view.getByRole('button', { name: 'Open Updated customer brief' })
  );
  expect(
    view.getByRole('textbox', { name: 'Document body' }).textContent
  ).toContain('Include two pricing options.');
  expect(
    view.getByRole('textbox', { name: 'Document body' }).querySelector('h2')
      ?.textContent
  ).toBe('Scope');
});

it('returns to the task list if the sample task is deleted', async () => {
  const view = render(() => <TaskContextDemo />);
  fireEvent.keyDown(view.getByRole('button', { name: 'Task actions' }), {
    key: 'ArrowDown',
  });
  await Promise.resolve();
  const remove = view.getByRole('menuitem', { name: 'Delete sample task' });
  remove.focus();
  fireEvent.keyDown(remove, { key: 'Enter' });
  expect(await view.findByText('No matching tasks.')).toBeTruthy();
});

it('types the sharing line, opens mentions at @, and ends with the channel inserted', () => {
  reduced = false;
  vi.useFakeTimers();
  const view = render(() => <TaskContextDemo />);
  const input = view.getByRole('textbox', { name: 'Task sharing instruction' });
  expect(input.textContent).toBe('');
  for (const callback of intersections)
    callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver
    );
  vi.advanceTimersByTime(1600);
  expect(input.textContent).toContain('Share the draft for review in');
  expect(view.queryByRole('listbox')).toBeNull();
  vi.advanceTimersByTime(250);
  expect(view.getByRole('listbox', { name: 'Mentions' })).toBeTruthy();
  expect(view.getByRole('option', { name: 'sales' })).toBeTruthy();
  vi.advanceTimersByTime(1200);
  expect(view.queryByRole('listbox')).toBeNull();
  expect(view.getByRole('button', { name: 'Open sales' })).toBeTruthy();
  expect(
    view.getByRole('textbox', { name: 'Task sharing instruction' }).textContent
  ).toContain('Share the draft for review in sales.');
  vi.advanceTimersByTime(20000);
  expect(view.queryByRole('region', { name: 'Linked task source' })).toBeNull();
});

it('keeps a visitor’s sharing instruction instead of continuing playback', () => {
  reduced = false;
  vi.useFakeTimers();
  const view = render(() => <TaskContextDemo />);
  const input = view.getByRole('textbox', { name: 'Task sharing instruction' });
  fireEvent.pointerDown(input);
  input.textContent = 'Keep my own instruction.';
  fireEvent.input(input);
  for (const callback of intersections)
    callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver
    );
  vi.advanceTimersByTime(20000);
  expect(input.textContent).toBe('Keep my own instruction.');
  expect(view.queryByRole('button', { name: 'Open sales' })).toBeNull();
});
