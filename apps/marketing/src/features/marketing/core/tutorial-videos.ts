/**
 * The app's Block tutorial videos that have a product page here. Titles and
 * lengths match the app's `tutorials` messages. The files are served from
 * `public/video/tutorials/`, which docs.macro.com also embeds from macro.com.
 */
export const TUTORIAL_VIDEOS = {
  mail: { title: 'Learn how to use Rox Mail', length: '1:42' },
  tasks: { title: 'Learn how to use Rox Tasks', length: '1:57' },
  chat: { title: 'Learn how to use Rox Chat', length: '1:30' },
  docs: { title: 'Learn how to use Rox Docs', length: '1:15' },
  calls: { title: 'Learn how to use Rox Calls', length: '1:10' },
  crm: { title: 'Learn how to use Rox CRM', length: '1:26' },
  agents: { title: 'Learn how to use Rox Agents', length: '1:05' },
  macrod: { title: 'Learn how to use MacroD', length: '1:17' },
  github: { title: 'Learn how to use Rox with GitHub', length: '1:01' },
} as const;

export type TutorialVideoId = keyof typeof TUTORIAL_VIDEOS;

/** Who presents the videos, shown on the play button. */
export const TUTORIAL_PRESENTER = 'Jacob Beckerman';

export const tutorialVideoUrl = (id: TutorialVideoId) =>
  `/video/tutorials/${id}.mp4`;

export const tutorialPosterUrl = (id: TutorialVideoId) =>
  `/video/tutorials/${id}-poster.jpg`;
