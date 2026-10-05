import { VIEW_SHELL_TOUR } from '@app/components/view-shell/tour';
import { APP_TOUR } from '@app/features/command/sidebar/tour';
import { defineViewTour } from '@app/features/tours/core/view-tour';
import { defineTourTargets } from '@ui/components/Tour';

export const AGENTS_TOUR = defineTourTargets('agents', [
  'newChat',
  'rosterNav',
  'picker',
  'composer',
  'agentsTab',
  'runtimesTab',
]);

const openRoster = {
  entry: [AGENTS_TOUR.rosterNav, VIEW_SHELL_TOUR.sidebarToggle],
  entryLabel: 'Open Agents to continue',
};

export const agentsTour = defineViewTour({
  id: 'agents',
  title: 'Agents',
  steps: [
    {
      target: AGENTS_TOUR.picker,
      entry: [AGENTS_TOUR.newChat, VIEW_SHELL_TOUR.sidebarToggle],
      entryLabel: 'Start a new conversation to continue',
      title: 'Choose your agent and model',
      description:
        'Open this picker to choose a chat or coding agent. Models are listed here too; each agent’s submenu lets you choose a model for that conversation.',
    },
    {
      target: AGENTS_TOUR.agentsTab,
      ...openRoster,
      title: 'Chat agents work with your context',
      description:
        'Chat agents use instructions and connected tools to research, write, and work with your documents and conversations. Your team and private agents live here.',
    },
    {
      target: AGENTS_TOUR.runtimesTab,
      ...openRoster,
      title: 'Coding agents work on code',
      description:
        'Coding agents run through a coding runtime, such as Cursor or a paired machine. Choose a coding agent when you need repository work rather than a regular chat.',
    },
    {
      target: AGENTS_TOUR.agentsTab,
      ...openRoster,
      title: 'Share agents with your team',
      description:
        'Team agents are available to teammates; private agents belong to you. When creating or editing an agent, choose Team or Private alongside its instructions and tools.',
    },
    {
      target: APP_TOUR.createMenu,
      title: 'Put recurring work on a schedule',
      description:
        'Use Create → Routine to give an agent instructions and a schedule—for example, a weekly summary or daily triage. Review the routine’s runs and pause it when you need to.',
    },
  ],
});
