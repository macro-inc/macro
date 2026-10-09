import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@solidjs/testing-library';
import { unwrap } from 'solid-js/store';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  CHANNEL_DOC,
  CHANNEL_EMAIL,
  createChannelHeroProject,
} from '../channels/channelProject';
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
  fireEvent.click(home.getByRole('button', { name: 'Julia' }));
  expect(screen.queryByRole('textbox', { name: 'Thread reply' })).toBeNull();
  expect(screen.getByRole('log', { name: 'Channel dm-julia' })).toBeTruthy();
  expect(
    screen.getByRole('textbox', { name: 'Message #dm-julia' })
  ).toBeTruthy();
});

it('keeps the populated Chat sidebar while opening documents and email in independent splits', () => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1440);
  const view = render(() => {
    const project = createChannelHeroProject();
    return (
      <DummyWorkspace
        embedded
        initialView="messages"
        initialData={unwrap(project.data)}
        initialChannelThread="start"
        chatSplits
      />
    );
  });
  const nav = within(
    view.getByRole('complementary', { name: 'Chat navigation' })
  );
  expect(nav.getByRole('button', { name: 'engineering' })).toBeTruthy();
  expect(nav.getByRole('button', { name: 'Gabriel' })).toBeTruthy();
  expect(nav.getByRole('button', { name: 'Valentina' })).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: CHANNEL_DOC }));
  expect(
    view.getByRole('textbox', { name: 'Document title' }).textContent
  ).toBe(CHANNEL_DOC);
  expect(view.getByRole('log', { name: 'Channel launch' })).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: CHANNEL_EMAIL }));
  expect(view.container.querySelectorAll('.channel-work-item')).toHaveLength(2);
  expect(
    view.container.querySelector('.channel-work-split')?.getAttribute('style')
  ).toContain('--channel-pane-count: 3');
  const email = view.container.querySelector(
    '[data-pane-view="email"]'
  ) as HTMLElement;
  fireEvent.click(
    within(email).getByRole('button', { name: 'Close shared work' })
  );
  expect(view.container.querySelectorAll('.channel-work-item')).toHaveLength(1);
  fireEvent.click(nav.getByRole('button', { name: 'Valentina' }));
  expect(view.getByRole('log', { name: 'Channel dm-valentina' })).toBeTruthy();
  expect(view.getByText('looks much sharper, thanks')).toBeTruthy();
});

it('supports Chat search, collapsible groups, and opening a thread from the sidebar', () => {
  const view = render(() => {
    const project = createChannelHeroProject();
    return (
      <DummyWorkspace
        embedded
        initialView="messages"
        initialData={unwrap(project.data)}
      />
    );
  });
  const nav = within(
    view.getByRole('complementary', { name: 'Chat navigation' })
  );
  fireEvent.click(nav.getByRole('button', { name: 'Channels' }));
  expect(nav.queryByRole('button', { name: 'engineering' })).toBeNull();
  fireEvent.click(nav.getByRole('button', { name: 'Channels' }));
  fireEvent.click(nav.getByRole('button', { name: 'Search conversations' }));
  fireEvent.input(
    nav.getByRole('searchbox', { name: 'Search channels and direct messages' }),
    { target: { value: 'Gabriel' } }
  );
  expect(nav.getByRole('button', { name: 'Gabriel' })).toBeTruthy();
  expect(nav.queryByRole('button', { name: 'engineering' })).toBeNull();
  fireEvent.click(nav.getByRole('button', { name: 'Close search' }));
  fireEvent.click(nav.getByRole('radio', { name: 'Threads' }));
  fireEvent.click(
    nav.getByRole('button', { name: /morning, doing a last pass on the site/ })
  );
  expect(
    view.container
      .querySelector('[data-thread-id="history-morning"]')
      ?.getAttribute('data-thread-open')
  ).toBe('true');
});
