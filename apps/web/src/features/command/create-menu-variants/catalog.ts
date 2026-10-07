import { AnimatedCallIcon } from '@icon/wide-call';
import { AnimatedChannelIcon } from '@icon/wide-channel';
import { AnimatedChatIcon } from '@icon/wide-chat';
import { AnimatedDiagramIcon } from '@icon/wide-diagram';
import { AnimatedEmailIcon } from '@icon/wide-email';
import { AnimatedFileCodeIcon } from '@icon/wide-fileCode';
import { AnimatedFileMdIcon } from '@icon/wide-fileMd';
import { AnimatedFolderIcon } from '@icon/wide-folder';
import { AnimatedSnippetIcon } from '@icon/wide-snippet';
import { AnimatedStarIcon } from '@icon/wide-star';
import { AnimatedTaskIcon } from '@icon/wide-task';
import type { Component } from 'solid-js';
import type { CreatableBlock } from '../types';

export type AnimatedIcon = Component<{
  triggerAnimation?: boolean;
  class?: string;
}>;

export type CreateMenuGroupId = 'docs' | 'visual' | 'talk' | 'plan' | 'ai';

export type CreateMenuGroup = {
  id: CreateMenuGroupId | 'other';
  label: string;
  tagline: string;
};

export const CREATE_MENU_GROUPS: readonly CreateMenuGroup[] = [
  { id: 'docs', label: 'Docs & files', tagline: 'Write, template, organize' },
  {
    id: 'visual',
    label: 'Visual & data',
    tagline: 'Diagram, design, crunch numbers',
  },
  { id: 'talk', label: 'Communicate', tagline: 'Reach people' },
  { id: 'plan', label: 'Plan & track', tagline: 'Stay on top of the work' },
  { id: 'ai', label: 'AI & automation', tagline: 'Put agents to work' },
];

const OTHER_GROUP: CreateMenuGroup = {
  id: 'other',
  label: 'More',
  tagline: 'Everything else',
};

export type CreateMenuDetails = {
  group: CreateMenuGroupId;
  /** One line under the title: what the thing actually is. */
  tagline: string;
  /** A sentence or two for roomier layouts. */
  details: string;
  /** Things people typically make with it. */
  examples: readonly string[];
  animatedIcon?: AnimatedIcon;
};

/**
 * Keyed by label rather than block name: Message and Channel share the
 * `channel` block, and the two Agent entries (one per agents flag) are never
 * both shown.
 */
const DETAILS: Record<string, CreateMenuDetails> = {
  Document: {
    group: 'docs',
    tagline: 'Rich-text doc, edited live together',
    details:
      'A collaborative document for notes, specs and write-ups, with headings, tables, embeds, comments and AI editing.',
    examples: ['Meeting notes', 'Product spec', 'Team wiki'],
    animatedIcon: AnimatedFileMdIcon,
  },
  Snippet: {
    group: 'docs',
    tagline: 'Reusable template for your writing',
    details:
      'Save text you write again and again — boilerplate, checklists, canned replies — and reuse it whenever you need it.',
    examples: ['Doc template', 'Checklist', 'Canned reply'],
    animatedIcon: AnimatedSnippetIcon,
  },
  Code: {
    group: 'docs',
    tagline: 'Code file with syntax highlighting',
    details:
      'A standalone source file for scripts, queries and config, in whatever language you need.',
    examples: ['Python script', 'SQL query', 'Config file'],
    animatedIcon: AnimatedFileCodeIcon,
  },
  Folder: {
    group: 'docs',
    tagline: 'Keep related files together',
    details:
      'Organize documents, files and other folders in one place, and share them together.',
    examples: ['Client files', 'Archive', 'Team drive'],
    animatedIcon: AnimatedFolderIcon,
  },
  Canvas: {
    group: 'visual',
    tagline: 'Whiteboard for diagrams and sketches',
    details:
      'An infinite canvas for flowcharts, mind maps, architecture diagrams and freeform brainstorming.',
    examples: ['Flowchart', 'Mind map', 'Architecture diagram'],
    animatedIcon: AnimatedDiagramIcon,
  },
  Design: {
    group: 'visual',
    tagline: 'Figma-compatible design editor',
    details:
      'A vector design tool that opens and saves Figma (.fig) files — frames, components and multiplayer editing for UI mockups and graphics.',
    examples: ['App mockup', 'Social graphic', 'Design system'],
  },
  Spreadsheet: {
    group: 'visual',
    tagline: 'Excel-style workbook with formulas',
    details:
      'A collaborative spreadsheet with formulas, multiple sheets and AI-assisted editing for models, budgets and analysis.',
    examples: ['Budget', 'Financial model', 'Tracker'],
  },
  Database: {
    group: 'visual',
    tagline: 'Structured records in tables and boards',
    details:
      'Typed fields and records you can view as a table or a board — for CRMs, trackers and inventories.',
    examples: ['CRM', 'Content calendar', 'Inventory'],
  },
  Email: {
    group: 'talk',
    tagline: 'Compose from your connected inbox',
    details:
      'Write and send an email from your connected email account, with AI help drafting.',
    examples: ['Follow-up', 'Intro', 'Update to a client'],
    animatedIcon: AnimatedEmailIcon,
  },
  Message: {
    group: 'talk',
    tagline: 'Quick DM to a person or group',
    details:
      'Send a direct message to one or more teammates without setting up a channel.',
    examples: ['Quick question', 'Heads-up', 'Group DM'],
    animatedIcon: AnimatedChatIcon,
  },
  Channel: {
    group: 'talk',
    tagline: 'Ongoing space for a team or topic',
    details:
      'A persistent conversation for a team, project or topic, with threads, files and everyone who needs to be in the loop.',
    examples: ['#design', '#launch', '#support'],
    animatedIcon: AnimatedChannelIcon,
  },
  Call: {
    group: 'talk',
    tagline: 'Start an audio or video call',
    details:
      'Jump into a call right away and invite teammates or external guests.',
    examples: ['Quick sync', 'Pairing', 'Customer call'],
    animatedIcon: AnimatedCallIcon,
  },
  Task: {
    group: 'plan',
    tagline: 'To-do with owner, status and due date',
    details:
      'Capture a piece of work, assign it, set a due date and track it through to done.',
    examples: ['Bug', 'Follow-up', 'Review request'],
    animatedIcon: AnimatedTaskIcon,
  },
  Project: {
    group: 'plan',
    tagline: 'Group tasks toward a shared goal',
    details:
      'Collect related tasks under one goal and follow their progress together.',
    examples: ['Launch', 'Quarterly goal', 'Migration'],
  },
  Reminder: {
    group: 'plan',
    tagline: 'Nudge yourself at a time you pick',
    details:
      'Ask Macro to remind you about something later — no document or task required.',
    examples: ['Call back', 'Check in Friday', 'Renew license'],
  },
  Agent: {
    group: 'ai',
    tagline: 'AI session that researches, writes and codes',
    details:
      'A dedicated agent session. Hand it a task and it works through it step by step — research, writing, code and more.',
    examples: ['Research a topic', 'Draft a doc', 'Fix a bug'],
    animatedIcon: AnimatedStarIcon,
  },
  Routine: {
    group: 'ai',
    tagline: 'Run an agent on a schedule or trigger',
    details:
      'Automations that run a model or agent on a schedule, or whenever something happens in Macro.',
    examples: ['Daily digest', 'Triage inbox', 'Weekly report'],
  },
  Skill: {
    group: 'ai',
    tagline: 'Reusable instructions for agents',
    details:
      'Teach agents how you want something done — a process, a format, a checklist — and they apply it whenever it fits.',
    examples: ['Brand voice', 'PR review', 'Report format'],
  },
};

export function createMenuDetails(
  item: CreatableBlock
): CreateMenuDetails | undefined {
  return DETAILS[item.label];
}

/** The one-line description a variant shows under the title. */
export function createMenuTagline(item: CreatableBlock): string {
  const fallback =
    typeof item.description === 'function'
      ? item.description()
      : item.description;
  return createMenuDetails(item)?.tagline ?? item.launcherHint ?? fallback;
}

/** Extra text that search should match on, beyond the block's own fields. */
export function createMenuSearchText(item: CreatableBlock): string[] {
  const details = createMenuDetails(item);
  if (!details) return [];
  const group = CREATE_MENU_GROUPS.find((g) => g.id === details.group);
  return [
    details.tagline,
    details.details,
    ...details.examples,
    group?.label,
  ].filter((text): text is string => !!text);
}

export type CreateMenuSection = {
  group: CreateMenuGroup;
  items: CreatableBlock[];
};

/** Splits items into the fixed groups, keeping each group's catalog order. */
export function groupCreateMenuItems(
  items: readonly CreatableBlock[]
): CreateMenuSection[] {
  const order = Object.keys(DETAILS);
  const rank = (item: CreatableBlock) => {
    const index = order.indexOf(item.label);
    return index === -1 ? order.length : index;
  };

  const sections = CREATE_MENU_GROUPS.map((group) => ({
    group,
    items: items
      .filter((item) => createMenuDetails(item)?.group === group.id)
      .sort((a, b) => rank(a) - rank(b)),
  }));
  const ungrouped = items.filter((item) => !createMenuDetails(item));
  if (ungrouped.length > 0) {
    sections.push({ group: OTHER_GROUP, items: ungrouped });
  }

  return sections.filter((section) => section.items.length > 0);
}

/** Two-to-four word captions for compact cards. */
const SHORT_TAGLINES: Record<string, string> = {
  Document: 'Rich text, edited together',
  Snippet: 'Reusable template',
  Code: 'Syntax-highlighted file',
  Folder: 'Keep files together',
  Canvas: 'Diagrams & whiteboard',
  Design: 'Figma-compatible editor',
  Spreadsheet: 'Formulas & sheets',
  Database: 'Tables & boards',
  Email: 'Compose from inbox',
  Message: 'Quick DM',
  Channel: 'Team discussion',
  Call: 'Audio or video',
  Task: 'Track work',
  Project: 'Group tasks to a goal',
  Reminder: 'Nudge yourself later',
  Agent: 'Dedicated agent session',
  Routine: 'Scheduled agent runs',
  Skill: 'Reusable agent know-how',
};

export function createMenuShortTagline(item: CreatableBlock): string {
  return SHORT_TAGLINES[item.label] ?? createMenuTagline(item);
}
