import { VIEW_SHELL_TOUR } from '@app/components/view-shell/tour';
import { defineViewTour } from '@app/features/tours/core/view-tour';
import { defineTourTargets } from '@ui/components/Tour';

/** Parts of the shared list view that tours can point at. */
export const SOUP_TOUR = defineTourTargets('soup', ['list']);

export const callsTour = defineViewTour({
  id: 'calls',
  title: 'Calls',
  video: { youtubeId: 'MMG00RA7kU0', title: 'Macro Calls', duration: '1:15' },
  steps: [
    {
      target: SOUP_TOUR.list,
      title: 'Pick up the conversation',
      description:
        'Find your recent calls here, alongside the work they relate to.',
    },
    {
      target: VIEW_SHELL_TOUR.main,
      title: 'Revisit the details',
      description:
        'Open a call to review its available transcript and catch up on what was discussed.',
    },
    {
      target: VIEW_SHELL_TOUR.aside,
      entry: VIEW_SHELL_TOUR.sidebarToggle,
      entryLabel: 'Show the sidebar to continue',
      title: 'Keep momentum',
      description:
        'Bring decisions back into your documents, tasks, and team conversations.',
    },
  ],
});

export const foldersTour = defineViewTour({
  id: 'folders',
  title: 'Folders',
  steps: [
    {
      target: [VIEW_SHELL_TOUR.aside, SOUP_TOUR.list],
      title: 'Give a project a home',
      description:
        'Group related work in a folder so it’s easy to find and return to.',
    },
    {
      target: VIEW_SHELL_TOUR.main,
      title: 'Bring the pieces together',
      description:
        'Move items into folders and open them without losing the surrounding context.',
    },
    {
      target: VIEW_SHELL_TOUR.topBar,
      title: 'Find what you need',
      description:
        'Use search and filters to narrow down the items in your workspace.',
    },
  ],
});
