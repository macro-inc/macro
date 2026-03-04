import { createMemo, createSignal, type Accessor } from 'solid-js';
import type { InputTaskData } from './types';

export type TaskMode = {
  enabled: Accessor<boolean>;
  tasks: Accessor<InputTaskData[]>;
  toggle: () => void;
};

export function createTaskMode(value: Accessor<string>): TaskMode {
  const [enabled, setEnabled] = createSignal(false);

  const tasks = createMemo<InputTaskData[]>(() => {
    if (!enabled()) return [];
    return value()
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .slice(0, 3)
      .map((title, index) => ({
        id: `task-${index + 1}`,
        title,
      }));
  });

  const toggle = () => setEnabled((prev) => !prev);

  return { enabled, tasks, toggle };
}
