import { AnimatedFileMdIcon } from '@icon/wide-fileMd';
import { AnimatedTaskIcon } from '@icon/wide-task';
import TagIcon from '@phosphor/tag.svg';
import type { Component } from 'solid-js';

/**
 * One "put the agent to work" example: the row's copy plus the prompt it
 * sends. Kept as plain data — these are edited for wording far more often
 * than the behavior around them, which is identical for every example (start
 * a chat with the prompt; see `getting-started.tsx`).
 */
export type AgentExample = {
  id: string;
  icon: Component<{ class?: string }>;
  title: string;
  description: string;
  prompt: string;
};

/** App links the example prompts ask the agent to include in its reply. */
const MANAGE_TAGS_LINK = 'macro.com/app/settings/tags';
const TASKS_LIST_LINK = 'macro.com/app/component/tasks';

export const AGENT_EXAMPLES: AgentExample[] = [
  {
    id: 'example-organize-inbox',
    icon: TagIcon,
    title: 'Auto-organize my inbox',
    description: 'Categorize and tag your recent email',
    prompt: `Categorize and tag recent emails in my inbox. Link me to ${MANAGE_TAGS_LINK} where I can manage all of my tags.`,
  },
  {
    id: 'example-pull-tasks',
    icon: AnimatedTaskIcon,
    title: 'Pull tasks from inbox',
    description: 'Turn important emails into tasks',
    prompt: `Find my most important recent emails and create tasks from them. Link me to ${TASKS_LIST_LINK} where I can see all of my tasks.`,
  },
  {
    id: 'example-weekly-brief',
    icon: AnimatedFileMdIcon,
    title: 'Build weekly brief',
    description: 'Summarize your week with links to sources',
    prompt:
      'Review my recent emails, documents, and tasks from the past week. Identify key decisions, open questions, blockers, and next steps, then create a concise weekly briefing document with links to the original sources.',
  },
  {
    id: 'example-auto-tag-tasks',
    icon: TagIcon,
    title: 'Auto-tag my tasks',
    description: 'Keep your task list organized automatically',
    prompt: `Review my open tasks and apply helpful tags to organize them. Link me to ${MANAGE_TAGS_LINK} where I can manage all of my tags.`,
  },
];
