import type { CreatableBlock } from '../types';

export type CreateMenuGroupId = 'docs' | 'visual' | 'talk' | 'plan' | 'ai';

export type CreateMenuGroup = {
  id: CreateMenuGroupId | 'other' | 'recent';
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
  /** A 10–20-word description for the detailed launcher. */
  details: string;
  /** Things people typically make with it. */
  examples: readonly string[];
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
  },
  Snippet: {
    group: 'docs',
    tagline: 'Reusable template for your writing',
    details:
      'Save reusable templates, checklists and replies so you can quickly add familiar content to new documents.',
    examples: ['Doc template', 'Checklist', 'Canned reply'],
  },
  Code: {
    group: 'docs',
    tagline: 'Code file with syntax highlighting',
    details:
      'A standalone source file for scripts, queries and config, in whatever language you need.',
    examples: ['Python script', 'SQL query', 'Config file'],
  },
  Folder: {
    group: 'docs',
    tagline: 'Keep related files together',
    details:
      'Organize documents, files and other folders in one place, and share them together.',
    examples: ['Client files', 'Archive', 'Team drive'],
  },
  Canvas: {
    group: 'visual',
    tagline: 'Whiteboard for diagrams and sketches',
    details:
      'An infinite canvas for flowcharts, mind maps, architecture diagrams and freeform brainstorming.',
    examples: ['Flowchart', 'Mind map', 'Architecture diagram'],
  },
  Design: {
    group: 'visual',
    tagline: 'Figma-compatible design editor',
    details:
      'Create interface mockups and graphics with frames and vector shapes, then save your work as a Figma file.',
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
      'Organize structured records with custom fields, then explore them in tables and boards for trackers, inventories or customer lists.',
    examples: ['CRM', 'Content calendar', 'Inventory'],
  },
  Form: {
    group: 'visual',
    tagline: 'Collect responses',
    details:
      'Build a form to collect feedback, requests or survey answers, with every response saved into a database.',
    examples: ['Survey', 'Intake form', 'Feedback'],
  },
  'Photoshop file': {
    group: 'visual',
    tagline: 'Layered image editing',
    details:
      'Create and edit layered images for photo edits, composites and graphics, then save your work as a Photoshop file.',
    examples: ['Photo edit', 'Composite', 'Banner'],
  },
  'Illustrator file': {
    group: 'visual',
    tagline: 'Vector artwork',
    details:
      'Create scalable logos, icons and illustrations on artboards, then save your vector artwork as an Illustrator file.',
    examples: ['Logo', 'Illustration', 'Icon set'],
  },
  Email: {
    group: 'talk',
    tagline: 'Compose from your connected inbox',
    details:
      'Write and send an email from your connected email account, with AI help drafting.',
    examples: ['Follow-up', 'Intro', 'Update to a client'],
  },
  Message: {
    group: 'talk',
    tagline: 'Quick DM to a person or group',
    details:
      'Send a direct message to one or more teammates without setting up a channel.',
    examples: ['Quick question', 'Heads-up', 'Group DM'],
  },
  Channel: {
    group: 'talk',
    tagline: 'Ongoing space for a team or topic',
    details:
      'Keep a team, project or topic in one shared conversation, with threaded discussions and files everyone can find.',
    examples: ['#design', '#launch', '#support'],
  },
  Call: {
    group: 'talk',
    tagline: 'Start an audio or video call',
    details:
      'Jump into a call right away and invite teammates or external guests.',
    examples: ['Quick sync', 'Pairing', 'Customer call'],
  },
  Task: {
    group: 'plan',
    tagline: 'To-do with owner, status and due date',
    details:
      'Capture a piece of work, assign it, set a due date and track it through to done.',
    examples: ['Bug', 'Follow-up', 'Review request'],
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
      'Start a dedicated AI session to research a topic, draft content or work through a coding task.',
    examples: ['Research a topic', 'Draft a doc', 'Fix a bug'],
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
      'Give agents reusable instructions for a specific process, writing style or workflow so they can follow your preferred approach.',
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

/** Recent choices appear once, before the remaining categorized options. */
export function groupRecentCreateMenuItems(
  items: CreatableBlock[],
  recentItems: CreatableBlock[]
): CreateMenuSection[] {
  const recent = recentItems.filter((item) => items.includes(item));
  const categories = groupCreateMenuItems(
    items.filter((item) => !recent.includes(item))
  );
  return recent.length
    ? [
        {
          group: { id: 'recent', label: 'Recents', tagline: 'Recently used' },
          items: recent,
        },
        ...categories,
      ]
    : categories;
}

/** Two-to-four word captions for compact cards. */
const SHORT_TAGLINES: Record<string, string> = {
  Document: 'Collaborative writing',
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
  Project: 'Organize related tasks',
  Reminder: 'Nudge yourself later',
  Agent: 'Dedicated agent session',
  Routine: 'Automate recurring work',
  Skill: 'Reusable agent instructions',
  Form: 'Collect responses',
  'Photoshop file': 'Layered image editing',
  'Illustrator file': 'Vector artwork',
};

export function createMenuShortTagline(item: CreatableBlock): string {
  return SHORT_TAGLINES[item.label] ?? createMenuTagline(item);
}
