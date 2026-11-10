/**
 * The app's Block tutorial videos that have a product page here. Titles and
 * lengths match the app's `tutorials` messages. The files are served from
 * `public/video/tutorials/`, which the merged documentation also embeds.
 */
export const TUTORIAL_VIDEOS = {
  home: {
    feature: 'Home',
    title: 'Learn how to use Macro Home',
    length: '1:00',
  },
  calendar: {
    feature: 'Calendar',
    title: 'Learn how to use Macro Calendar',
    length: '0:54',
  },
  scheduling: {
    feature: 'Booking Links',
    title: 'Learn how to use Macro Booking Links',
    length: '0:44',
  },
  drive: {
    feature: 'Drive',
    title: 'Learn how to use Macro Drive',
    length: '1:29',
  },
  mail: {
    feature: 'Email',
    title: 'Learn how to use Macro Mail',
    length: '1:42',
  },
  tasks: {
    feature: 'Tasks',
    title: 'Learn how to use Macro Tasks',
    length: '1:57',
  },
  chat: {
    feature: 'Chat',
    title: 'Learn how to use Macro Chat',
    length: '1:30',
  },
  docs: {
    feature: 'Docs',
    title: 'Learn how to use Macro Docs',
    length: '1:15',
  },
  spreadsheets: {
    feature: 'Spreadsheets',
    title: 'Learn how to use Macro Spreadsheets',
    length: '0:56',
  },
  databases: {
    feature: 'Databases',
    title: 'Learn how to use Macro Databases',
    length: '1:05',
  },
  canvas: {
    feature: 'Canvas',
    title: 'Learn how to use Macro Canvas',
    length: '0:50',
  },
  calls: {
    feature: 'Calls',
    title: 'Learn how to use Macro Calls',
    length: '1:10',
  },
  crm: { feature: 'CRM', title: 'Learn how to use Macro CRM', length: '1:26' },
  agents: {
    feature: 'Agents',
    title: 'Learn how to use Macro Agents',
    length: '1:05',
  },
  macrod: {
    feature: 'Snippets',
    title: 'Learn how to use MacroD',
    length: '1:17',
  },
  github: {
    feature: 'GitHub',
    title: 'Learn how to use Macro with GitHub',
    length: '1:01',
  },
  routines: {
    feature: 'Routines',
    title: 'Learn how to use Macro Routines',
    length: '1:01',
    preview: 'native',
  },
  skills: {
    feature: 'Skills',
    title: 'Learn how to use Macro Skills',
    length: '0:49',
    preview: 'native',
  },
  'company-graph': {
    feature: 'Company graph',
    title: 'Learn how to use Macro Company graph',
    length: '0:47',
    preview: 'benefit',
  },
  'ai-tagging': {
    feature: 'AI tagging',
    title: 'Learn how to use Macro AI tagging',
    length: '0:39',
    preview: 'benefit',
  },
  'automatic-permissions': {
    feature: 'Automatic permissions',
    title: 'Learn how to use Macro Automatic permissions',
    length: '0:42',
    preview: 'benefit',
  },
  'workspace-events': {
    feature: 'Workspace events',
    title: 'Learn how to use Macro Workspace events',
    length: '0:49',
    preview: 'benefit',
  },
  'unified-search': {
    feature: 'Unified search',
    title: 'Learn how to use Macro Unified search',
    length: '0:46',
    preview: 'benefit',
  },
} as const;

export type TutorialVideoId = keyof typeof TUTORIAL_VIDEOS;

/** Who presents the videos, shown on the play button. */
export const TUTORIAL_PRESENTER = 'Jacob Beckerman';

export const tutorialVideoUrl = (id: TutorialVideoId) =>
  `/video/tutorials/${id}.mp4`;

export const tutorialPosterUrl = (id: TutorialVideoId) =>
  `/video/tutorials/${id}-poster.jpg`;

/** Overview frame used by the website's shared desktop-window preview. */
export const tutorialPreviewUrl = (id: TutorialVideoId, light = false) =>
  `/video/tutorials/${id}-preview${light ? '-light' : ''}.jpg`;
