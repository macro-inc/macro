import { ViewShell } from '@app/components/view-shell';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EMPTY_CONVERSATION_FILTERS } from '../../core/conversation-filters';
import type { AgentsPage } from '../../core/pages';
import { PhoneAgentsNavigation } from './agents-navigation';
import { PhoneListHeader } from './phone-list-header';

vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => true }));
vi.mock('@app/components/view-shell/create-frame-width', () => ({
  createFrameWidth: () => () => 390,
}));
vi.mock('@core/hotkey/hotkeys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/hotkey/hotkeys')>()),
  registerHotkey: vi.fn(),
}));
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 390, 844)
  );
  vi.stubGlobal('scrollTo', vi.fn());
  const computedStyle = window.getComputedStyle;
  vi.stubGlobal('getComputedStyle', (element: Element) => {
    const style = computedStyle(element);
    style.transitionDuration ||= '0s';
    style.animationName ||= 'none';
    return style;
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup() {
  const onPage = vi.fn();
  const createAgent = vi.fn();
  const createRoutine = vi.fn();
  const openRoutine = vi.fn();
  const filter = vi.fn();
  const [page, setPage] = createSignal<AgentsPage>('new');
  const [search, setSearch] = createSignal('');
  render(() => (
    <ViewShell.Root
      contentLayout="collection"
      asidePreferenceKey="navigation-integration"
    >
      <ViewShell.Aside>
        <PhoneAgentsNavigation
          activePage={page()}
          routines={[
            { id: 'routine-a', name: 'Daily review', schedule: 'Daily' },
          ]}
          onOpenPage={(next) => {
            onPage(next);
            setPage(next);
          }}
          onCreateAgent={createAgent}
          onCreateRoutine={createRoutine}
          onOpenRoutine={openRoutine}
        />
      </ViewShell.Aside>
      <ViewShell.Main>
        <PhoneListHeader
          archived={page() === 'archived'}
          empty={false}
          search={search()}
          onSearchChange={setSearch}
          filters={EMPTY_CONVERSATION_FILTERS}
          onFilterChange={filter}
          onClearFilters={vi.fn()}
          showUnlistedRuns={false}
          onShowUnlistedRunsChange={vi.fn()}
        />
      </ViewShell.Main>
    </ViewShell.Root>
  ));
  return { onPage, createAgent, createRoutine, openRoutine, filter, search };
}

function tap(element: Element) {
  fireEvent.pointerDown(element, {
    pointerType: 'touch',
    pointerId: 1,
    isPrimary: true,
  });
  fireEvent.pointerUp(element, {
    pointerType: 'touch',
    pointerId: 1,
    isPrimary: true,
  });
  fireEvent.click(element);
}

it('runs every phone navigation and creation action through the real sheet', async () => {
  const actions = setup();
  for (const [label, expected] of [
    ['Conversations', 'new'],
    ['Archived', 'archived'],
    ['Agents', 'agents'],
    ['Routines', 'routines'],
  ] as const) {
    tap(screen.getAllByRole('button', { name: 'Show sidebar' })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Sidebar' });
    expect(dialog.hasAttribute('inert')).toBe(false);
    tap(screen.getByRole('button', { name: label }));
    expect(actions.onPage).toHaveBeenLastCalledWith(expected);
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Sidebar' })).toBeNull()
    );
  }
  for (const [label, callback] of [
    ['New agent', actions.createAgent],
    ['Create routine', actions.createRoutine],
    ['Daily review Daily', actions.openRoutine],
  ] as const) {
    tap(screen.getAllByRole('button', { name: 'Show sidebar' })[0]);
    await screen.findByRole('dialog', { name: 'Sidebar' });
    tap(screen.getByRole('button', { name: label }));
    expect(callback).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Sidebar' })).toBeNull()
    );
  }
});

it('dismisses the sheet and keeps search and filters interactive', async () => {
  const actions = setup();
  tap(screen.getAllByRole('button', { name: 'Show sidebar' })[0]);
  const dialog = await screen.findByRole('dialog', { name: 'Sidebar' });
  fireEvent.keyDown(dialog, { key: 'Escape' });
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'Sidebar' })).toBeNull()
  );
  tap(screen.getByRole('button', { name: 'Search conversations' }));
  const search = screen.getByRole('searchbox');
  fireEvent.input(search, { target: { value: 'review' } });
  expect(actions.search()).toBe('review');
  fireEvent.keyDown(search, { key: 'Escape' });
  expect(actions.search()).toBe('');
  tap(screen.getByRole('button', { name: 'Filter conversations' }));
  expect(await screen.findByRole('dialog')).toBeTruthy();
  tap(screen.getByRole('checkbox', { name: 'Unread' }));
  expect(actions.filter).toHaveBeenCalledWith('status', 'unread', true);
  tap(screen.getByRole('button', { name: 'Close filters' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  tap(screen.getByRole('button', { name: 'Show sidebar' }));
  await screen.findByRole('dialog', { name: 'Sidebar' });
  const overlay = document.querySelector('[data-corvu-drawer-overlay]');
  expect(overlay).not.toBeNull();
  tap(overlay!);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
