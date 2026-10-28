import type { CreatableBlock } from '../types';

export type CreateMenuGroupId =
  | 'docs'
  | 'organization'
  | 'design'
  | 'data'
  | 'comms'
  | 'tasks'
  | 'ai'
  | 'other';

export type CreateMenuGroup = {
  id: CreateMenuGroupId | 'recent';
  label: string;
  tagline: string;
};

export const CREATE_MENU_GROUPS: readonly CreateMenuGroup[] = [
  { id: 'docs', label: 'Docs', tagline: 'Write and template' },
  {
    id: 'organization',
    label: 'Organization',
    tagline: 'Keep related work together',
  },
  { id: 'design', label: 'Design', tagline: 'Diagram, sketch, design' },
  { id: 'data', label: 'Data', tagline: 'Collect, organize, analyze' },
  { id: 'comms', label: 'Comms', tagline: 'Reach people' },
  { id: 'tasks', label: 'Tasks', tagline: 'Stay on top of the work' },
  { id: 'ai', label: 'AI', tagline: 'Put agents to work' },
  { id: 'other', label: 'Other', tagline: 'Everything else' },
];

export type CreateMenuDetails = {
  group: CreateMenuGroupId;
  /** One line under the title: what the thing actually is. */
  tagline: string;
  /** Two authored lines; the second is slightly shorter at desktop width. */
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
      'Write notes, specs and ideas together in one place.\nAdd tables, embeds, comments and AI edits.',
    examples: ['Meeting notes', 'Product spec', 'Team wiki'],
  },
  Snippet: {
    group: 'docs',
    tagline: 'Reusable template for your writing',
    details:
      'Save templates, checklists and your go-to replies.\nReuse your familiar content in new documents.',
    examples: ['Doc template', 'Checklist', 'Canned reply'],
  },
  Code: {
    group: 'other',
    tagline: 'Code file with syntax highlighting',
    details:
      'Create a source file for scripts, queries or config.\nWrite in the language that best fits your work.',
    examples: ['Python script', 'SQL query', 'Config file'],
  },
  Folder: {
    group: 'organization',
    tagline: 'Keep related files together',
    details:
      'Keep related documents and files in one place.\nOrganize folders and share them together.',
    examples: ['Client files', 'Archive', 'Team drive'],
  },
  Canvas: {
    group: 'design',
    tagline: 'Whiteboard for diagrams and sketches',
    details:
      'Map out ideas on an infinite shared whiteboard.\nSketch flows, diagrams and connections.',
    examples: ['Flowchart', 'Mind map', 'Architecture diagram'],
  },
  Design: {
    group: 'design',
    tagline: 'Figma-compatible design editor',
    details:
      'Design interfaces and graphics with vector tools.\nBuild with frames and save as a Figma file.',
    examples: ['App mockup', 'Social graphic', 'Design system'],
  },
  Database: {
    group: 'data',
    tagline: 'Structured records in tables and boards',
    details:
      'Organize records with fields that fit your work.\nExplore your data in tables and boards.',
    examples: ['CRM', 'Content calendar', 'Inventory'],
  },
  Spreadsheet: {
    group: 'data',
    tagline: 'Excel-style workbook with formulas',
    details:
      'Build shared spreadsheets for budgets and models.\nUse formulas, multiple sheets and AI edits.',
    examples: ['Budget', 'Financial model', 'Tracker'],
  },
  Form: {
    group: 'data',
    tagline: 'Collect responses',
    details:
      'Collect feedback, requests and survey responses.\nSave every answer directly into your database.',
    examples: ['Survey', 'Intake form', 'Feedback'],
  },
  'Photoshop file': {
    group: 'design',
    tagline: 'Layered image editing',
    details:
      'Create layered images, photo edits and graphics.\nSave your work as a layered Photoshop file.',
    examples: ['Photo edit', 'Composite', 'Banner'],
  },
  'Illustrator file': {
    group: 'design',
    tagline: 'Vector artwork',
    details:
      'Draw scalable logos, icons and vector illustrations.\nWork on artboards and save an Illustrator file.',
    examples: ['Logo', 'Illustration', 'Icon set'],
  },
  Email: {
    group: 'comms',
    tagline: 'Compose from your connected inbox',
    details:
      'Write and send email from your connected inbox.\nDraft and refine each message with AI help.',
    examples: ['Follow-up', 'Intro', 'Update to a client'],
  },
  Message: {
    group: 'comms',
    tagline: 'Quick DM to a person or group',
    details:
      'Start a direct conversation with your teammates.\nSend a quick note to one person or a group.',
    examples: ['Quick question', 'Heads-up', 'Group DM'],
  },
  Channel: {
    group: 'comms',
    tagline: 'Ongoing space for a team or topic',
    details:
      'Give your team or project a shared conversation.\nKeep threads and files together in one place.',
    examples: ['#design', '#launch', '#support'],
  },
  Call: {
    group: 'comms',
    tagline: 'Start an audio or video call',
    details:
      'Bring people together for an audio or video call.\nInvite teammates and guests to join you live.',
    examples: ['Quick sync', 'Pairing', 'Customer call'],
  },
  Task: {
    group: 'tasks',
    tagline: 'To-do with owner, status and due date',
    details:
      'Turn a piece of work into a task with a clear owner.\nSet a due date and follow it through to done.',
    examples: ['Bug', 'Follow-up', 'Review request'],
  },
  Project: {
    group: 'tasks',
    tagline: 'Group tasks toward a shared goal',
    details:
      'Bring related tasks together around a shared goal.\nKeep track of progress across your project.',
    examples: ['Launch', 'Quarterly goal', 'Migration'],
  },
  Reminder: {
    group: 'tasks',
    tagline: 'Nudge yourself at a time you pick',
    details:
      'Set a reminder for something you want to revisit.\nChoose a time and let Macro bring it back.',
    examples: ['Call back', 'Check in Friday', 'Renew license'],
  },
  Agent: {
    group: 'ai',
    tagline: 'AI session that researches, writes and codes',
    details:
      'Start an AI session to move your work forward.\nResearch a topic, draft content or write code.',
    examples: ['Research a topic', 'Draft a doc', 'Fix a bug'],
  },
  Routine: {
    group: 'ai',
    tagline: 'Run an agent on a schedule or trigger',
    details:
      'Put recurring work on a schedule or a trigger.\nLet an agent take care of it automatically.',
    examples: ['Daily digest', 'Triage inbox', 'Weekly report'],
  },
  Skill: {
    group: 'ai',
    tagline: 'Reusable instructions for agents',
    details:
      'Give agents reusable instructions for your work.\nDefine a process, style or preferred approach.',
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
    details.details.replace(/\n/g, ' '),
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
      .filter(
        (item) => (createMenuDetails(item)?.group ?? 'other') === group.id
      )
      .sort((a, b) => rank(a) - rank(b)),
  }));
  return sections.filter((section) => section.items.length > 0);
}

/**
 * Recent choices appear first and leave their categories: the list shows no
 * section headers, so a second copy would read as a duplicate.
 */
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
