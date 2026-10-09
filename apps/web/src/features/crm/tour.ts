import { VIEW_SHELL_TOUR } from '@app/components/view-shell/tour';
import { defineViewTour } from '@app/features/tours/core/view-tour';
import { defineTourTargets } from '@ui/components/Tour';

export const COMPANIES_TOUR = defineTourTargets('companies', [
  'records',
  'create',
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
      target: COMPANIES_TOUR.records,
      entry: VIEW_SHELL_TOUR.sidebarToggle,
      entryLabel: 'Show the Customers sidebar to continue',
      title: 'Companies and people',
      description:
        'Companies lists every customer your team works with. People lists their contacts across your teams.',
    },
    {
      target: VIEW_SHELL_TOUR.main,
      title: 'See the whole relationship',
      description:
        'Open a company to view its contacts and details. Update properties as the relationship develops.',
    },
    {
      target: COMPANIES_TOUR.create,
      entry: VIEW_SHELL_TOUR.sidebarToggle,
      entryLabel: 'Show the Customers sidebar to continue',
      title: 'Add your own records',
      description:
        'Use New to add a company, a contact, or a pipeline. Filters and saved views in the toolbar focus the list on the companies that matter.',
    },
  ],
});
