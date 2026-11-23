import {
  type TutorialVideoId,
  tutorialPreviewUrl,
} from '../core/tutorial-videos';

/** Pages whose hero opens on a tutorial's preview frame. */
export const PAGE_TUTORIALS: Record<string, TutorialVideoId> = {
  '/email': 'mail',
  '/tasks': 'tasks',
  '/channels': 'chat',
  '/documents': 'docs',
  '/calls': 'calls',
  '/crm': 'crm',
  '/agents': 'agents',
  '/github': 'github',
  '/forms': 'forms',
  '/spreadsheets': 'spreadsheets',
  '/databases': 'databases',
  '/canvas': 'canvas',
  '/calendar': 'calendar',
  '/booking-links': 'scheduling',
  '/drive': 'drive',
  '/routines': 'routines',
  '/skills': 'skills',
};

const requested = new Set<TutorialVideoId>();

/**
 * Fetch a page's hero preview before the visitor opens the page, so the frame
 * is already there when the page appears. Call it when a link to `path` is
 * pointed at or focused.
 */
export function preloadTutorialPreview(path: string) {
  const tutorial = PAGE_TUTORIALS[path];
  if (!tutorial || requested.has(tutorial)) return;
  requested.add(tutorial);
  new Image().src = tutorialPreviewUrl(tutorial);
}
