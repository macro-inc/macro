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
import { ProjectSavedViewsList } from './project-saved-views';

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

it('selects project views and starts creation from the shared sidebar section', async () => {
  const [open, setOpen] = createSignal(false);
  render(() => <ProjectSavedViewsList open={open()} onOpenChange={setOpen} />);
  fireEvent.click(screen.getByRole('button', { name: 'New saved view' }));
  expect(open()).toBe(true);
  expect(views.start).toHaveBeenCalledOnce();
  expect(views.creating()).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'New view, draft' }));
  expect(views.creating()).toBe(true);
  expect(views.select).not.toHaveBeenCalled();

  const list = screen.getByRole('navigation', { name: 'Saved project views' });
  fireEvent.click(
    within(list).getByRole('button', {
      name: 'Launch projects, shared with team',
    })
  );
  await waitFor(() => expect(views.select).toHaveBeenCalledWith(record.id));
  expect(views.creating()).toBe(false);
  expect(views.selectedId()).toBe(record.id);
});
