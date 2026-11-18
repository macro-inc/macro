import { createRoot, createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';
import type { ProjectDetail } from '../core/project';
import { createAddProjectTasks } from './add-project-tasks';

const project: ProjectDetail = {
  id: 'project',
  name: 'Launch',
  taskIds: [],
  ownerId: 'owner',
  memberIds: [],
  access: 'owner',
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

it('keeps a replacement picker draft when an earlier assignment fails', async () => {
  const pending = Promise.withResolvers<{ taskId: string; error?: string }[]>();
  const assignTasks = vi.fn(() => pending.promise);
  const state = createRoot((dispose) => ({
    dispose,
    picker: createAddProjectTasks({ project: () => project, assignTasks }),
  }));
  try {
    state.picker.select(new Set(['first']));
    const first = state.picker.add();
    state.picker.reset();
    state.picker.select(new Set(['second']));
    pending.resolve([{ taskId: 'first', error: 'Assignment failed' }]);
    expect(await first).toBe(false);
    expect([...state.picker.selected()]).toEqual(['second']);
    expect(state.picker.error()).toBeUndefined();
    expect(state.picker.saving()).toBe(false);
  } finally {
    state.dispose();
  }
});

it('rechecks project editing access before assigning the selected tasks', async () => {
  const assignTasks = vi.fn(async () => [{ taskId: 'task' }]);
  const state = createRoot((dispose) => {
    const [current, setCurrent] = createSignal(project);
    return {
      dispose,
      setCurrent,
      picker: createAddProjectTasks({ project: current, assignTasks }),
    };
  });
  try {
    state.picker.select(new Set(['task']));
    state.setCurrent({ ...project, access: 'view' });
    expect(await state.picker.add()).toBe(false);
    expect(assignTasks).not.toHaveBeenCalled();
  } finally {
    state.dispose();
  }
});

it('does not report a disposed picker assignment as a current success', async () => {
  const pending = Promise.withResolvers<{ taskId: string }[]>();
  const state = createRoot((dispose) => ({
    dispose,
    picker: createAddProjectTasks({
      project: () => project,
      assignTasks: () => pending.promise,
    }),
  }));
  state.picker.select(new Set(['task']));
  const result = state.picker.add();
  state.dispose();
  pending.resolve([{ taskId: 'task' }]);
  expect(await result).toBe(false);
});
