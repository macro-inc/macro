import { VIEW_SHELL_TOUR } from '@app/components/view-shell';
import { defineViewTour } from '@app/features/tours/core/view-tour';
import { defineTourTargets } from '@ui/components/Tour';

export const TASKS_TOUR = defineTourTargets('tasks', ['tags']);

export const tasksTour = defineViewTour({
  id: 'tasks',
  title: 'Tasks',
  connector: { kind: 'mcp', label: 'Linear', tools: ['Linear'] },
  video: { youtubeId: 'gxJquVXRX5A', title: 'Macro Tasks', duration: '1:35' },
  steps: [
    {
      target: VIEW_SHELL_TOUR.aside,
      entry: VIEW_SHELL_TOUR.sidebarToggle,
      entryLabel: 'Show the task sidebar to continue',
      title: 'Turn plans into progress',
      description:
        'Create a task with a clear next step, or connect Linear to bring your issues into Macro.',
    },
    {
      target: VIEW_SHELL_TOUR.main,
      title: 'Give work an owner',
      description:
        'Open a task to set its assignee, due date, and status. Add context so the next step is clear.',
    },
    {
      target: TASKS_TOUR.tags,
      entry: VIEW_SHELL_TOUR.sidebarToggle,
      entryLabel: 'Show the task sidebar to continue',
      title: 'Keep tasks organized with tags',
      description:
        'Tag tasks by project, team, or type of work. Create and manage tags here, then select a tag to narrow your task list to what matters now.',
    },
  ],
});
