import type { RoutineTemplate } from './types';

export const routineTemplates: readonly RoutineTemplate[] = [
  {
    id: 'morning-brief',
    name: 'Start the day informed',
    description:
      'A focused briefing from your tasks, conversations, and calendar.',
    category: 'Macro',
    integration: 'Macro · Calendar',
    days: ['2', '3', '4', '5', '6'],
    time: '09:00',
    prompt:
      'Prepare my morning briefing. Read my open Macro tasks, unread messages, and today’s calendar. Highlight deadlines, blockers, and decisions needing my attention. Group the briefing into Today, Waiting on, and Worth knowing, with links to the source items. Keep it concise. Do not modify tasks or send messages.',
  },
  {
    id: 'team-pulse',
    name: 'Keep the team in sync',
    description:
      'Turn this week’s work into progress, decisions, and next steps.',
    category: 'Macro',
    integration: 'Macro',
    days: ['6'],
    time: '16:00',
    prompt:
      'Prepare a weekly team pulse from the Macro channels and projects I reference here. Summarize completed work, important decisions, blocked tasks, and next week’s priorities. Link every claim to a source. Call out missing owners without assigning them. Return a draft update for review.',
  },
  {
    id: 'task-sweep',
    name: 'Catch work that slipped',
    description:
      'Find overdue tasks, missing owners, and unanswered questions.',
    category: 'Macro',
    integration: 'Macro',
    days: ['2', '4', '6'],
    time: '15:00',
    prompt:
      'Review my open Macro tasks and recent project conversations. Identify overdue work, tasks without a clear next step, and questions that have gone unanswered. Prioritize a short follow-up list with links and suggested actions. Avoid duplicating previous findings when nothing has changed. Do not change tasks or contact anyone.',
  },
  {
    id: 'meeting-prep',
    name: 'Walk into meetings prepared',
    description: 'Gather the context and open questions for upcoming meetings.',
    category: 'Macro',
    integration: 'Calendar · Macro',
    days: ['2', '3', '4', '5', '6'],
    time: '08:30',
    prompt:
      'Read today’s calendar and prepare short briefs for meetings with available context. Find related Macro documents, tasks, and conversations. For each meeting include the objective, recent decisions, unresolved questions, and useful links. Do not invent context for meetings without accessible sources.',
  },
  {
    id: 'stripe-pulse',
    name: 'Spot revenue signals',
    description: 'Summarize payments and cancellations from the Stripe bot.',
    category: 'Integrations',
    integration: 'Stripe bot · Macro',
    days: ['2', '3', '4', '5', '6'],
    time: '09:30',
    prompt:
      'Read the last 24 hours of Stripe payment bot messages in the Macro channels I reference here. Summarize new payments, trials converting to paid, and subscription cancellations. Separate observed events from interpretations. Link to source messages and flag customers worth a follow-up. These notifications are not a complete ledger: do not infer total revenue, churn rate, refunds, or missing payment events. Return a draft report only.',
  },
  {
    id: 'incident-watch',
    name: 'Follow up on incidents',
    description:
      'Track Anthropic status updates and their impact on your team.',
    category: 'Integrations',
    integration: 'Anthropic status bot · Macro',
    days: ['1', '2', '3', '4', '5', '6', '7'],
    time: '10:00',
    prompt:
      'Review recent Anthropic status bot posts in the Macro channels I reference here. Summarize active incidents, the latest provider update, and any team-reported impact. Link to incident and channel messages. Distinguish provider statements from our observations. If all incidents are resolved, say so briefly. Do not claim live provider status beyond the available updates.',
  },
  {
    id: 'github-digest',
    name: 'Review what shipped',
    description: 'A digest of pull requests, releases, and review bottlenecks.',
    category: 'Integrations',
    integration: 'GitHub connection',
    days: ['2', '3', '4', '5', '6'],
    time: '16:30',
    prompt:
      'Using the GitHub tools available to this agent, review the repositories I reference here. Summarize merged pull requests and releases since the previous workday, flag failing checks on open pull requests, and highlight reviews waiting more than two working days. Include links and suggest next steps. Do not modify repositories, approve pull requests, or post comments. If GitHub access is unavailable, report that clearly.',
  },
  {
    id: 'linear-triage',
    name: 'Keep the issue queue moving',
    description:
      'Surface urgent, unassigned, and stalled issues before they grow.',
    category: 'Integrations',
    integration: 'Linear connection',
    days: ['2', '3', '4', '5', '6'],
    time: '10:30',
    prompt:
      'Using the Linear tools connected to this agent, review recent issues for the teams I reference here. Highlight urgent unassigned issues, blocked work, and possible duplicates with evidence and links. Suggest a prioritized triage list. Do not change priority, assign issues, or close duplicates. If Linear access is unavailable, report that clearly.',
  },
];
