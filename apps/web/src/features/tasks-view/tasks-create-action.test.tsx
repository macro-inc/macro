import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { Show } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TasksCreateAction } from './tasks-create-action';

const mocks = vi.hoisted(() => ({ popoverSplit: vi.fn() }));

vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ popoverSplit: mocks.popoverSplit }),
}));
vi.mock('@queries/team/teams', () => ({
  useCurrentTeamQuery: () => ({
    isSuccess: true,
    data: { team: { id: 'team' } },
  }),
}));
vi.mock('@app/features/property/tags/TagEditorDialog', () => ({
  TagEditorDialog: (props: { open: boolean; onClose: () => void }) => (
    <Show when={props.open}>
      <div role="dialog" aria-label="New tag">
        <button type="button" onClick={props.onClose}>
          Cancel
        </button>
      </div>
    </Show>
  ),
}));

let motionStyles: HTMLStyleElement;
beforeEach(() => {
  motionStyles = document.createElement('style');
  motionStyles.textContent =
    '[role="menu"] { animation-name: none; transition-duration: 0s; }';
  document.head.append(motionStyles);
  vi.stubGlobal('scrollTo', vi.fn());
});
afterEach(() => {
  cleanup();
  motionStyles.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe.each(['sidebar', 'toolbar'] as const)(
  '%s New menu',
  (presentation) => {
    it.each([
      ['Task', 'task-compose'],
      ['Project', 'project-compose'],
    ])('opens the %s composer', async (label, id) => {
      render(() => (
        <TasksCreateAction presentation={presentation} projectsEnabled />
      ));
      fireEvent.keyDown(
        screen.getByRole('button', { name: 'New task, project, or tag' }),
        { key: 'Enter' }
      );
      fireEvent.keyDown(await screen.findByRole('menuitem', { name: label }), {
        key: 'Enter',
      });
      await waitFor(() =>
        expect(mocks.popoverSplit).toHaveBeenCalledExactlyOnceWith({
          type: 'component',
          id,
        })
      );
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('opens and closes the tag editor without creating a task or project', async () => {
      render(() => (
        <TasksCreateAction presentation={presentation} projectsEnabled />
      ));
      fireEvent.keyDown(
        screen.getByRole('button', { name: 'New task, project, or tag' }),
        { key: 'Enter' }
      );
      fireEvent.keyDown(await screen.findByRole('menuitem', { name: 'Tag' }), {
        key: 'Enter',
      });
      await screen.findByRole('dialog', { name: 'New tag' });
      expect(screen.queryByRole('menu')).toBeNull();
      expect(mocks.popoverSplit).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  }
);

it('keeps project creation behind the existing Projects gate', async () => {
  render(() => (
    <TasksCreateAction presentation="sidebar" projectsEnabled={false} />
  ));
  fireEvent.keyDown(screen.getByRole('button', { name: 'New task or tag' }), {
    key: 'Enter',
  });
  await screen.findByRole('menuitem', { name: 'Task' });
  expect(screen.queryByRole('menuitem', { name: 'Project' })).toBeNull();
  expect(screen.getByRole('menuitem', { name: 'Tag' })).toBeDefined();
});
