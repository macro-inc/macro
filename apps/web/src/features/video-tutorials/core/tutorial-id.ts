/**
 * The videos the app can show: each block's "Learn how to use" tutorial, then
 * the videos about how Macro works across blocks (Company graph and the rest).
 * The id keys the video's assets and messages, is sent with analytics as
 * `macro-<id>`, and orders the shelf of more videos.
 */
export const TUTORIAL_IDS = [
  'mail',
  'home',
  'chat',
  'tasks',
  'docs',
  'spreadsheets',
  'databases',
  'canvas',
  'drive',
  'crm',
  'calendar',
  'calls',
  'agents',
  'macrod',
  'routines',
  'skills',
  'forms',
  'github',
  'scheduling',
  'whatsapp',
  'company-graph',
  'ai-tagging',
  'automatic-permissions',
  'workspace-events',
  'unified-search',
] as const;

export type TutorialId = (typeof TUTORIAL_IDS)[number];

/**
 * Where a tutorial's dismissal is remembered on this device. Mail keeps the
 * key it shipped with, so people who already dismissed it don't see it again.
 */
export function tutorialDismissedKey(id: TutorialId): string {
  return id === 'mail'
    ? 'email-tutorial-row-dismissed'
    : `tutorial-${id}-dismissed`;
}
