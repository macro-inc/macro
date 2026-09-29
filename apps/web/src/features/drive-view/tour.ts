import { VIEW_SHELL_TOUR } from '@app/components/view-shell/tour';
import { defineViewTour } from '@app/features/tours/core/view-tour';

export const documentsTour = defineViewTour({
  id: 'documents',
  title: 'Documents',
  connector: { kind: 'mcp', label: 'Notion', tools: ['Notion'] },
  video: { youtubeId: 'V8wE8Hq5_qw', title: 'Macro Docs', duration: '1:09' },
  steps: [
    {
      target: VIEW_SHELL_TOUR.aside,
      entry: VIEW_SHELL_TOUR.sidebarToggle,
      entryLabel: 'Show the Documents sidebar to continue',
      title: 'A place for your ideas',
      description:
        'Create a document or bring your existing files into Macro. Search and filter to find them again.',
    },
    {
      target: VIEW_SHELL_TOUR.main,
      title: 'Connect the context',
      description:
        'In a document, type @ to mention people or link related work.',
    },
    {
      target: VIEW_SHELL_TOUR.topBar,
      title: 'Think together',
      description:
        'Share a document and use comments to keep feedback close to the work.',
    },
  ],
});
