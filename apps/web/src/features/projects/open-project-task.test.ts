import { projectTaskRoute } from '@app/routes/routes';
import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  openProjectTask,
  type ProjectTaskOpener,
  useOpenProjectTask,
} from './open-project-task';

const fixtures = vi.hoisted(() => ({
  inline: true,
  touch: false,
  navigate: vi.fn(() => Promise.resolve()),
  openWithSplit: vi.fn(),
}));

vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => fixtures.touch,
}));
vi.mock('@app/components/view-shell/use-inline-preview-layout', () => ({
  useInlinePreviewLayout: () => () => fixtures.inline,
}));
vi.mock('@app/lib/split-router', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useNavigate: () => fixtures.navigate,
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: fixtures.openWithSplit }),
}));

afterEach(() => {
  fixtures.inline = true;
  fixtures.touch = false;
  fixtures.navigate.mockClear();
  fixtures.openWithSplit.mockClear();
});

function opener(inline: boolean) {
  return {
    inline,
    showInProject: vi.fn<ProjectTaskOpener['showInProject']>(),
    openInSplit: vi.fn<ProjectTaskOpener['openInSplit']>(),
  };
}

describe('openProjectTask', () => {
  it('shows a task in the project on a plain click where details show in place', () => {
    const open = opener(true);
    openProjectTask('task-1', { event: new MouseEvent('click') }, open);
    expect(open.showInProject).toHaveBeenCalledWith('task-1');
    expect(open.openInSplit).not.toHaveBeenCalled();
  });

  it('opens a task as a task, in a new split with Shift', () => {
    const open = opener(true);
    openProjectTask(
      'task-1',
      { event: new MouseEvent('click', { shiftKey: true }) },
      open
    );
    expect(open.openInSplit).toHaveBeenCalledWith(
      { type: 'task', id: 'task-1' },
      { preferNewSplit: true }
    );
    expect(open.showInProject).not.toHaveBeenCalled();
  });

  it('opens a task as a task where details cannot show in place, not as a plain document', () => {
    const open = opener(false);
    openProjectTask('task-1', undefined, open);
    expect(open.openInSplit).toHaveBeenCalledWith(
      { type: 'task', id: 'task-1' },
      { preferNewSplit: undefined }
    );
  });
});

describe('useOpenProjectTask', () => {
  const openFrom = () =>
    createRoot((dispose) => {
      const open = useOpenProjectTask({
        projectId: () => 'project-1',
        section: () => 'time',
      });
      dispose();
      return open;
    });

  it('shows a task in the project’s pane on a tablet', () => {
    fixtures.touch = true;
    fixtures.inline = true;
    openFrom()('task-1');
    expect(fixtures.navigate).toHaveBeenCalledWith({
      route: projectTaskRoute,
      params: { projectId: 'project-1', section: 'time', taskId: 'task-1' },
    });
    expect(fixtures.openWithSplit).not.toHaveBeenCalled();
  });

  it('opens a task in a split on a phone', () => {
    fixtures.touch = true;
    fixtures.inline = false;
    openFrom()('task-1');
    expect(fixtures.openWithSplit).toHaveBeenCalledWith(
      { type: 'task', id: 'task-1' },
      { preferNewSplit: undefined }
    );
    expect(fixtures.navigate).not.toHaveBeenCalled();
  });
});
