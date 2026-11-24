import { describe, expect, it, vi } from 'vitest';
import { openProjectTask, type ProjectTaskOpener } from './open-project-task';

function opener(touch: boolean) {
  return {
    touch,
    showInProject: vi.fn<ProjectTaskOpener['showInProject']>(),
    openInSplit: vi.fn<ProjectTaskOpener['openInSplit']>(),
  };
}

describe('openProjectTask', () => {
  it('shows a task beside the project on a plain desktop click', () => {
    const open = opener(false);
    openProjectTask('task-1', { event: new MouseEvent('click') }, open);
    expect(open.showInProject).toHaveBeenCalledWith('task-1');
    expect(open.openInSplit).not.toHaveBeenCalled();
  });

  it('opens a task as a task, in a new split with Shift', () => {
    const open = opener(false);
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

  it('opens a task as a task on touch, not as a plain document', () => {
    const open = opener(true);
    openProjectTask('task-1', undefined, open);
    expect(open.openInSplit).toHaveBeenCalledWith(
      { type: 'task', id: 'task-1' },
      { preferNewSplit: undefined }
    );
  });
});
