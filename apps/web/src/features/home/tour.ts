import { VIEW_SHELL_TOUR } from '@app/components/view-shell';
import { defineViewTour } from '@app/features/tours/core/view-tour';
import { defineTourTargets } from '@ui/components/Tour';

export const HOME_TOUR = defineTourTargets('home', ['list', 'filter']);

export const homeTour = defineViewTour({
  id: 'home',
  title: 'Home',
  video: {
    youtubeId: 'Fn5hdzXsQQ8',
    title: 'Macro Product Demo',
    duration: '4:45',
  },
  steps: [
    {
      target: HOME_TOUR.list,
      entry: VIEW_SHELL_TOUR.sidebarToggle,
      entryLabel: 'Show your Home list to continue',
      title: 'See your work together',
      description:
        'Home brings docs, DMs, emails, tasks, files, agents, and group chats into one place.',
    },
    {
      target: HOME_TOUR.filter,
      entry: VIEW_SHELL_TOUR.sidebarToggle,
      entryLabel: 'Show your Home list to continue',
      title: 'Open the context',
      description:
        'Select an item to preview it beside your list. Use the filter to narrow what you see.',
    },
    {
      target: VIEW_SHELL_TOUR.main,
      title: 'Start something new',
      description:
        'Choose New chat to work with an agent, or use Create in the sidebar to start a document, task, or conversation.',
    },
  ],
});
