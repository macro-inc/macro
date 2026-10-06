import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import DummyWorkspace from './DummyWorkspace';

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.stubGlobal('PointerEvent', MouseEvent);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  cleanup();
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('opens the same palette from Search and ⌘K without changing the underlying view', () => {
  render(() => <DummyWorkspace />);
  fireEvent.click(screen.getByRole('button', { name: 'Search workspace' }));
  expect(screen.getByRole('dialog', { name: 'Search workspace' })).toBeTruthy();
  expect(
    screen.getByRole('heading', {
      name: 'What should we work on?',
      hidden: true,
    })
  ).toBeTruthy();
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'k', metaKey: true });
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
  fireEvent.input(screen.getByRole('combobox'), {
    target: { value: 'Q3 launch' },
  });
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(
    within(
      screen.getByRole('complementary', { name: 'Home navigation' })
    ).getByRole('heading', {
      name: 'Home',
    })
  ).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Back to Home' })).toBeTruthy();
});

it('leaves page shortcuts alone when focus is outside an embedded workspace', () => {
  const view = render(() => <DummyWorkspace embedded />);
  fireEvent.keyDown(document.body, { key: 'k', metaKey: true });
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.keyDown(view.getByRole('button', { name: 'Search workspace' }), {
    key: 'k',
    metaKey: true,
  });
  expect(screen.getByRole('dialog', { name: 'Search workspace' })).toBeTruthy();
});

it('opens recent replies and coding sessions inside Home with their actual content', () => {
  render(() => <DummyWorkspace />);
  const home = within(
    screen.getByRole('complementary', { name: 'Home navigation' })
  );
  fireEvent.click(
    home.getByRole('button', { name: 'Teo replied in #engineers' })
  );
  const log = within(screen.getByRole('log', { name: 'Channel engineers' }));
  expect(
    log.getByText(
      /Transient failure, cancellation, and retry-limit checks passed/
    )
  ).toBeTruthy();
  expect(log.getByText('reviewed. ship it')).toBeTruthy();
  fireEvent.click(
    home.getByRole('button', { name: 'Claude Code · Review the invite flow' })
  );
  expect(screen.getByText('#481')).toBeTruthy();
  expect(
    screen.getByText(/Reviewed the invite flow. Existing members now return/)
  ).toBeTruthy();
  expect(home.getByRole('heading', { name: 'Home' })).toBeTruthy();
});

it('clears a thread reply when switching to another conversation', () => {
  render(() => <DummyWorkspace />);
  const home = within(
    screen.getByRole('complementary', { name: 'Home navigation' })
  );
  fireEvent.click(home.getByRole('button', { name: 'agents-team' }));
  fireEvent.click(
    within(screen.getByRole('log')).getAllByRole('button', {
      name: 'Reply',
    })[0]
  );
  expect(screen.getByRole('textbox', { name: 'Thread reply' })).toBeTruthy();
  fireEvent.click(home.getByRole('button', { name: 'Julia Westphal' }));
  expect(screen.queryByRole('textbox', { name: 'Thread reply' })).toBeNull();
  expect(screen.getByRole('log', { name: 'Channel dm-julia' })).toBeTruthy();
  expect(
    screen.getByRole('textbox', { name: 'Message #dm-julia' })
  ).toBeTruthy();
});
