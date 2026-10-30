import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DemoMentionMenu } from '../DemoMentionMenu';
import { TaskContextDemo } from './TaskContextDemo';

let reduced = true;
let intersections: IntersectionObserverCallback[];
beforeEach(() => {
  reduced = true;
  intersections = [];
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: () => [],
  });
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
  Reflect.deleteProperty(Range.prototype, 'getClientRects');
  Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect');
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

it('inserts the document, email, and channel through their mention menus, then resets the full sequence', () => {
  reduced = false;
  vi.useFakeTimers();
  const view = render(() => <TaskContextDemo />);
  for (const callback of intersections)
    callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver
    );
  vi.advanceTimersByTime(1900);
  expect(
    view.getByRole('textbox', { name: 'Task document reference' }).textContent
  ).toBe('Us');
  advanceTo(() => view.queryByRole('option', { name: 'Customer brief' }));
  expect(view.getByRole('option', { name: 'Customer brief' })).toBeTruthy();
  vi.advanceTimersByTime(1100);
  expect(
    view.getByRole('button', { name: 'Open Customer brief' })
  ).toBeTruthy();
  expect(
    view.queryByRole('button', { name: 'Open Proposal request' })
  ).toBeNull();
  advanceTo(() => view.queryByRole('option', { name: 'Proposal request' }));
  expect(view.getByRole('option', { name: 'Proposal request' })).toBeTruthy();
  vi.advanceTimersByTime(1100);
  expect(
    view.getByRole('button', { name: 'Open Proposal request' })
  ).toBeTruthy();
  advanceTo(() => view.queryByRole('option', { name: 'sales' }));
  expect(view.getByRole('option', { name: 'sales' })).toBeTruthy();
  vi.advanceTimersByTime(1100);
  expect(view.getByRole('button', { name: 'Open sales' })).toBeTruthy();
  expect(view.queryByRole('listbox')).toBeNull();
  advanceTo(() =>
    view
      .getByRole('textbox', { name: 'Task sharing instruction' })
      .textContent?.endsWith('sales.')
  );
  expect(
    view.getByRole('textbox', { name: 'Task sharing instruction' }).textContent
  ).toContain('Share the draft for review in sales.');
  advanceTo(() => !view.queryByRole('button', { name: 'Open Customer brief' }));
  expect(
    view.queryByRole('button', { name: 'Open Customer brief' })
  ).toBeNull();
  expect(
    view.queryByRole('button', { name: 'Open Proposal request' })
  ).toBeNull();
  expect(view.queryByRole('button', { name: 'Open sales' })).toBeNull();
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

function advanceTo(reached: () => unknown) {
  for (let elapsed = 0; elapsed < 30000 && !reached(); elapsed += 50)
    vi.advanceTimersByTime(50);
  expect(!!reached()).toBe(true);
}

it('uses only the task’s mention picker when typing a channel reference', async () => {
  reduced = false;
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(),
  });
  const view = render(() => (
    <>
      <DemoMentionMenu />
      <TaskContextDemo />
    </>
  ));
  const input = view.getByRole('textbox', { name: 'Task sharing instruction' });
  fireEvent.pointerDown(input);
  input.focus();
  input.textContent = 'Share the draft for review in @';
  const range = document.createRange();
  range.selectNodeContents(input);
  range.collapse(false);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
  fireEvent.input(input);
  await Promise.resolve();
  expect(view.getAllByRole('listbox')).toHaveLength(1);
  expect(view.getByRole('option', { name: 'sales' })).toBeTruthy();
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(view.getByRole('button', { name: 'Open sales' })).toBeTruthy();
  expect(view.queryByRole('listbox')).toBeNull();
  Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect');
});
