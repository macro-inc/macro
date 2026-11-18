import { createMemoryHistory } from '@app/lib/split-router/history/memory';
import { createMemoryPaneStore } from '@app/lib/split-router/panes/memory-store';
import { createSplitRouter } from '@app/lib/split-router/router/create-router';
import { defineRoute } from '@app/lib/split-router/routes/define';
import type { SplitRoutes } from '@app/lib/split-router/routes/types';
import { SplitRouterProvider } from '@app/lib/split-router/solid/context';
import { Outlet } from '@app/lib/split-router/solid/outlet';
import { createTestPolicy } from '@app/lib/split-router/tests/fixtures';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal, For, onCleanup, Show } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SavedViewLeaveGuard } from './saved-view-leave-guard';

vi.mock('@ui', () => ({
  UnsavedChangesDialog: (props: {
    open: boolean;
    onKeepEditing: () => void;
    onDiscard: () => void;
    onSave: () => void;
  }) => (
    <Show when={props.open}>
      <button onClick={props.onKeepEditing}>Cancel leave</button>
      <button onClick={props.onDiscard}>Discard draft</button>
      <button onClick={props.onSave}>Save draft</button>
    </Show>
  ),
}));

afterEach(cleanup);

function setup(initiallyDirty = true) {
  const [dirty, setDirty] = createSignal(initiallyDirty);
  const [identity, setIdentity] = createSignal<string | undefined>('new-draft');
  const save = vi.fn(async () => {
    setDirty(false);
  });
  const discard = vi.fn(() => {
    setIdentity(undefined);
    setDirty(false);
  });
  let run = (action: () => void) => action();
  let internalNavigation = false;
  const DraftPage = () => (
    <>
      <SavedViewLeaveGuard
        source={{
          identity,
          viewerId: () => 'viewer',
          dirty,
          allowNavigation: () => internalNavigation,
          busy: () => false,
          save,
          discard,
          register: (next) => {
            run = next;
            return () => {};
          },
        }}
        selection={{ views: ['selected'] }}
      />
      <Outlet />
    </>
  );
  const routes: SplitRoutes = {
    definitions: [
      defineRoute({
        id: 'draft',
        path: 'draft',
        search: ['views'],
        component: DraftPage,
        children: [
          defineRoute({
            id: 'item',
            path: 'item',
            component: () => <p>item</p>,
          }),
        ],
      }),
      defineRoute({ id: 'home', path: 'home', component: () => <p>home</p> }),
    ],
    defaultRoute: () => ({ matches: [{ id: 'draft', params: {} }] }),
  };
  const router = createSplitRouter({
    routes,
    history: createMemoryHistory('/draft'),
    paneStore: createMemoryPaneStore(),
    policy: createTestPolicy().policy,
  });
  render(() => {
    onCleanup(() => router.dispose());
    return (
      <SplitRouterProvider router={router}>
        <For each={router.panes()}>{(pane) => <Outlet pane={pane} />}</For>
      </SplitRouterProvider>
    );
  });
  const pane = router.panes()[0]!;
  return {
    router,
    pane,
    save,
    discard,
    identity,
    run: (action: () => void) => run(action),
    internal: (action: () => void) => {
      internalNavigation = true;
      try {
        action();
      } finally {
        internalNavigation = false;
      }
    },
  };
}

describe('saved view leave integration', () => {
  it('does not guard the navigation that installs its own new draft', async () => {
    const state = setup();
    let result: ReturnType<typeof state.router.navigatePane> | undefined;
    state.internal(() => {
      result = state.router.navigatePane(state.pane, '/draft', {
        search: { views: { selected: ['new'] } },
      });
    });
    expect((await result)?.status).toBe('committed');
    expect(state.identity()).toBe('new-draft');
    expect(state.discard).not.toHaveBeenCalled();
    expect(screen.queryByText('Cancel leave')).toBeNull();
  });
  it('blocks opening an item under the list until Discard commits', async () => {
    const state = setup();
    const navigation = state.router.navigatePane(state.pane, '/draft/item');
    await screen.findByText('Discard draft');
    expect(state.discard).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Discard draft'));
    await navigation;
    expect(screen.getByText('item')).toBeTruthy();
    expect(state.discard).toHaveBeenCalledOnce();
  });

  it('keeps the draft when closing its pane is cancelled', async () => {
    const state = setup();
    const navigation = state.router.remove(state.pane);
    await screen.findByText('Cancel leave');
    fireEvent.click(screen.getByText('Cancel leave'));
    expect(await navigation).toBe(false);
    expect(state.router.panes()).toContain(state.pane);
    expect(state.identity()).toBe('new-draft');
    expect(screen.queryByText('home')).toBeNull();
  });

  it('does not prompt when only filters change', async () => {
    const state = setup();
    await state.router.navigatePane(state.pane, '/draft', {
      search: { views: { filter: ['changed'] } },
    });
    expect(screen.queryByText('Cancel leave')).toBeNull();
    expect(state.discard).not.toHaveBeenCalled();
    expect(state.identity()).toBe('new-draft');
  });

  it('prompts when the selected saved view changes', async () => {
    const state = setup();
    const navigation = state.router.navigatePane(state.pane, '/draft', {
      search: { views: { selected: ['saved'] } },
    });
    await screen.findByText('Save draft');
    fireEvent.click(screen.getByText('Save draft'));
    expect((await navigation).status).toBe('committed');
    expect(state.save).toHaveBeenCalledOnce();
  });

  it('guards state changes that happen before router navigation', async () => {
    const state = setup();
    const action = vi.fn();
    state.run(action);
    await screen.findByText('Discard draft');
    expect(action).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Discard draft'));
    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    expect(state.discard).toHaveBeenCalledOnce();
  });

  it('leaves a clean draft without a prompt', async () => {
    const state = setup(false);
    expect((await state.router.navigatePane(state.pane, '/home')).status).toBe(
      'committed'
    );
    expect(screen.queryByText('Cancel leave')).toBeNull();
    expect(state.discard).toHaveBeenCalledOnce();
  });
});
