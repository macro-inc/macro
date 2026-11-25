/**
 * The app's Block tutorial videos that have a product page here. Titles and
 * lengths match the app's `tutorials` messages. The files are served from
 * `public/video/tutorials/`, which the merged documentation also embeds.
 */
export const TUTORIAL_VIDEOS = {
  home: {
    feature: 'Home',
    title: 'Learn how to use Macro Home',
    length: '1:04',
  },
  forms: {
    feature: 'Forms',
    title: 'Learn how to use Macro Forms',
    length: '0:49',
  },
  calendar: {
    feature: 'Calendar',
    title: 'Learn how to use Macro Calendar',
    length: '1:03',
  },
  scheduling: {
    feature: 'Booking Links',
    title: 'Learn how to use Macro Booking Links',
    length: '1:17',
  },
  drive: {
    feature: 'Drive',
    title: 'Learn how to use Macro Drive',
    length: '1:04',
  },
  mail: {
    feature: 'Email',
    title: 'Learn how to use Macro Mail',
    length: '1:56',
  },
  tasks: {
    feature: 'Tasks',
    title: 'Learn how to use Macro Tasks',
    length: '1:20',
  },
  chat: {
    feature: 'Chat',
    title: 'Learn how to use Macro Chat',
    length: '1:11',
  },
  docs: {
    feature: 'Docs',
    title: 'Learn how to use Macro Docs',
    length: '1:09',
  },
  spreadsheets: {
    feature: 'Spreadsheets',
    title: 'Learn how to use Macro Spreadsheets',
    length: '1:07',
  },
  databases: {
    feature: 'Databases',
    title: 'Learn how to use Macro Databases',
    length: '1:22',
  },
  canvas: {
    feature: 'Canvas',
    title: 'Learn how to use Macro Canvas',
    length: '1:03',
  },
  calls: {
    feature: 'Calls',
    title: 'Learn how to use Macro Calls',
    length: '0:58',
  },
  crm: { feature: 'CRM', title: 'Learn how to use Macro CRM', length: '1:46' },
  agents: {
    feature: 'Agents',
    title: 'Learn how to use Macro Agents',
    length: '0:56',
  },
  macrod: {
    feature: 'MacroD',
    title: 'Learn how to use MacroD',
    length: '1:47',
  },
  'teams-admin': {
    feature: 'Teams & Admin',
    title: 'Learn how to use Macro Teams & Admin',
    length: '3:40',
    captions: true,
  },
  github: {
    feature: 'GitHub',
    title: 'Learn how to use Macro with GitHub',
    length: '0:51',
  },
  routines: {
    feature: 'Routines',
    title: 'Learn how to use Macro Routines',
    length: '1:01',
  },
  skills: {
    feature: 'Skills',
    title: 'Learn how to use Macro Skills',
    length: '0:49',
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

/**
 * Tutorials whose overview frame also exists for the light palette, captured
 * by scripts/capture-light-screens.mjs. The rest show their dark frame on
 * either palette; add an id here together with its `-preview-light.jpg`.
 */
const LIGHT_PREVIEWS: ReadonlySet<TutorialVideoId> = new Set([
  'agents',
  'calendar',
  'calls',
  'chat',
  'crm',
  'docs',
  'drive',
  'github',
  'home',
  'mail',
  'scheduling',
  'tasks',
  'teams-admin',
]);

export const hasLightTutorialPreview = (id: TutorialVideoId) =>
  LIGHT_PREVIEWS.has(id);

/** Overview frame used by the website's shared desktop-window preview. */
export const tutorialPreviewUrl = (id: TutorialVideoId, light = false) =>
  `/video/tutorials/${id}-preview${light && hasLightTutorialPreview(id) ? '-light' : ''}.jpg`;
