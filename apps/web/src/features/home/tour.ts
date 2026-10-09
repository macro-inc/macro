import { VIEW_SHELL_TOUR } from '@app/components/view-shell/tour';
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
        'Choose New and type what you have in mind. Home recognizes searches, AI questions, emails, notes, tasks, events, and messages, then shows the fields and action before you submit.',
    },
  ],
});
