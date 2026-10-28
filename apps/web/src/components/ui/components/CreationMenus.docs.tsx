import { TasksCreateMenu } from '@app/features/tasks-view/components/TasksCreateMenu';
import { defineDoc } from '@app/features/ui-gallery/types';
import { createSignal } from 'solid-js';

// #region demo:tasks
function TasksDemo() {
  const [selected, setSelected] = createSignal('Choose a creation action');
  return (
    <div class="flex flex-col items-center gap-4">
      <TasksCreateMenu
        presentation="toolbar"
        onCreateTask={() => setSelected('Task')}
        onCreateSubtask={() => setSelected('Subtask')}
        onCreateProject={() => setSelected('Project')}
        onCreateTag={() => setSelected('Tag')}
      />
      <p class="text-xs text-ink-muted">
        {selected()} — preview only, nothing is created.
      </p>
    </div>
  );
}
// #endregion
export default defineDoc({
  name: 'Creation Menus',
  category: 'Actions',
  description:
    'Creation choices use original icons and muted descriptions inside the existing New menu. Tasks, Agents, Calendar, Drive, and CRM share this row treatment.',
  guidelines: {
    do: [
      'Use CreateMenuItem for a title, icon, and short description of what each action creates.',
      'Wrap creation rows in Dropdown.Group to preserve the standard menu padding.',
    ],
    dont: [
      'Replace the existing New trigger or bypass feature gates when adding a creation choice.',
    ],
  },
  demos: [{ id: 'tasks', title: 'Tasks', render: TasksDemo }],
});
