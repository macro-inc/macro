import { VIEW_SHELL_TOUR } from '@app/components/view-shell';
import { defineViewTour } from '@app/features/tours/core/view-tour';
import { defineTourTargets } from '@ui/components/Tour';

export const COMPANIES_TOUR = defineTourTargets('companies', [
  'layout',
  'views',
]);

export const companiesTour = defineViewTour({
  id: 'companies',
  title: 'Customers',
  connector: {
    kind: 'mcp',
    label: 'HubSpot or Attio',
    tools: ['HubSpot', 'Attio'],
  },
  video: {
    youtubeId: '5d2K_NYs50k',
    title: 'Teams and CRM in Macro',
    duration: '2:33',
  },
  steps: [
    {
      target: COMPANIES_TOUR.layout,
      entry: VIEW_SHELL_TOUR.sidebarToggle,
      entryLabel: 'Show the Customers sidebar to continue',
      title: 'Your pipeline, as a board or list',
      description:
        'Switch to Board to see companies by stage, or List to scan their details in rows. Both show the same customer relationships—choose the view that fits your work.',
    },
    {
      target: VIEW_SHELL_TOUR.main,
      title: 'See the whole relationship',
      description:
        'Open a company to view its contacts and details. Update properties as the relationship develops.',
    },
    {
      target: COMPANIES_TOUR.views,
      entry: VIEW_SHELL_TOUR.sidebarToggle,
      entryLabel: 'Show the Customers sidebar to continue',
      title: 'Make your pipeline useful',
      description:
        'Use filters and saved views to focus on the right companies. Switch to the board to see work by stage.',
    },
  ],
});
