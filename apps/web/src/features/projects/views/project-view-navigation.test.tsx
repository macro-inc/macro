import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SavedView } from '../../saved-views/core/saved-view';
import type { ProjectScope } from '../core/project';
import { ProjectsDesktopTabs } from './project-view-tabs';
import { ProjectsMobileTabs } from './projects-mobile-tabs';

vi.mock('@core/hotkey/hotkeys', () => ({
  useHotkeyDOMScope: () => [() => {}],
}));
vi.mock('../context/project-saved-views-context', () => ({
  useProjectSavedViews: () => views,
}));
vi.mock('../../saved-views/queries/saved-view-actions', () => ({
  useUpdateSavedView: () => ({}),
}));
vi.mock('../../saved-views/queries/saved-views', () => ({
  toSavedView: (value: unknown) => value,
}));

const record: SavedView = {
  id: 'saved-projects',
  name: 'Launch projects',
  ownerId: 'viewer',
  sharedTeamId: 'team',
  revision: 1,
  config: {},
};

function createViews() {
  const [selectedId, setSelectedId] = createSignal<string>();
  const [creating, setCreating] = createSignal(false);
  const [scope, setScope] = createSignal<ProjectScope>('all');
  return {
    selectedId,
    creating,
    scope,
    active: () => true,
    viewerId: () => 'viewer',
    request: () => ({ isCurrent: () => true }),
    team: () => undefined,
    select: vi.fn((id?: string) => {
      setCreating(false);
      setSelectedId(id);
    }),
    selectScope: vi.fn((next: ProjectScope) => {
      setSelectedId(undefined);
      setCreating(false);
      setScope(next);
    }),
    start: vi.fn(() => {
      setSelectedId(undefined);
      setCreating(true);
    }),
    draft: {
      view: () => {
        if (selectedId()) return { kind: 'saved', record };
        if (creating()) return { kind: 'new' };
        return { kind: 'default' };
      },
    },
    list: {
      items: () => [record],
      loading: () => false,
      error: () => undefined,
      hasMore: () => false,
    },
  };
}
let views: ReturnType<typeof createViews>;
let animationStyle: HTMLStyleElement;

beforeEach(() => {
  views = createViews();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  animationStyle = document.createElement('style');
  animationStyle.textContent =
    '* { animation-name: none !important; transition-duration: 0s !important; }';
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(800);
  document.head.append(animationStyle);
});
afterEach(() => {
  cleanup();
  animationStyle.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each(['phone', 'desktop'])(
  'keeps %s navigation ordered and separates saved views from built-ins',
  async (platform) => {
    render(() =>
      platform === 'phone' ? (
        <ProjectsMobileTabs filters={<button>Filters</button>} />
      ) : (
        <ProjectsDesktopTabs
          filters={<button>Filters</button>}
          fallback={null}
        />
      )
    );
    const filters = screen.getByRole('button', { name: 'Filters' });
    const picker = screen.getByRole('button', { name: 'Saved views' });
    const tabRole = platform === 'phone' ? 'button' : 'radio';
    const builtIn = screen.getByRole(tabRole, { name: 'My projects' });
    expect(
      filters.compareDocumentPosition(picker) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      picker.compareDocumentPosition(builtIn) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    fireEvent.click(picker);
    const drawer = await screen.findByRole('dialog', { name: 'Saved views' });
    expect(within(drawer).queryByText('My projects')).toBeNull();
    expect(within(drawer).queryByText('All projects')).toBeNull();
    expect(within(drawer).queryByText('Created by me')).toBeNull();
    fireEvent.click(
      within(drawer).getByRole('button', {
        name: 'Launch projects, shared with team',
      })
    );
    await waitFor(() => expect(views.select).toHaveBeenCalledWith(record.id));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(
      screen
        .getByRole('button', { name: record.name })
        .getAttribute('aria-pressed')
    ).toBe('true');
    expect(
      screen
        .getByRole(tabRole, { name: 'All projects' })
        .hasAttribute('data-checked')
    ).toBe(false);

    fireEvent.click(screen.getByRole(tabRole, { name: 'My projects' }));
    expect(views.selectScope).toHaveBeenCalledWith('assigned-to-me');
    expect(views.selectedId()).toBeUndefined();
    expect(
      screen
        .getByRole('button', { name: 'Saved views' })
        .getAttribute('aria-pressed')
    ).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: 'Saved views' }));
    fireEvent.click(
      within(
        await screen.findByRole('dialog', { name: 'Saved views' })
      ).getByRole('button', { name: 'New view' })
    );
    await waitFor(() => expect(views.start).toHaveBeenCalledOnce());
    expect(
      screen
        .getByRole('button', { name: 'New view' })
        .getAttribute('aria-pressed')
    ).toBe('true');
  }
);
