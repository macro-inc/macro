/**
 * The app's tutorial videos that a page on macro.com opens: Block tutorials,
 * then the videos about Macro as a whole. Titles and lengths match the app's
 * `tutorials` messages. The files are served from `public/video/tutorials/`,
 * which docs.macro.com also embeds from macro.com.
 */
export const TUTORIAL_VIDEOS = {
  mail: { title: 'Learn how to use Macro Mail', length: '1:42' },
  tasks: { title: 'Learn how to use Macro Tasks', length: '1:57' },
  chat: { title: 'Learn how to use Macro Chat', length: '1:30' },
  docs: { title: 'Learn how to use Macro Docs', length: '1:15' },
  calls: { title: 'Learn how to use Macro Calls', length: '1:10' },
  crm: { title: 'Learn how to use Macro CRM', length: '1:26' },
  agents: { title: 'Learn how to use Macro Agents', length: '1:05' },
  macrod: { title: 'Learn how to use MacroD', length: '1:17' },
  routines: { title: 'Learn how to use Routines', length: '0:57' },
  skills: { title: 'Learn how to use Skills', length: '0:49' },
  github: { title: 'Learn how to use Macro with GitHub', length: '1:01' },
  'company-graph': { title: 'Company graph', length: '0:47' },
  'ai-tagging': { title: 'AI tagging', length: '0:39' },
  'automatic-permissions': { title: 'Automatic permissions', length: '0:42' },
  'workspace-events': { title: 'Workspace events', length: '0:49' },
  'unified-search': { title: 'Unified search', length: '0:46' },
} as const;

export type TutorialVideoId = keyof typeof TUTORIAL_VIDEOS;

/** Who presents the videos, shown on the play button. */
export const TUTORIAL_PRESENTER = 'Jacob Beckerman';

export const tutorialVideoUrl = (id: TutorialVideoId) =>
  `/video/tutorials/${id}.mp4`;

export const tutorialPosterUrl = (id: TutorialVideoId) =>
  `/video/tutorials/${id}-poster.jpg`;
