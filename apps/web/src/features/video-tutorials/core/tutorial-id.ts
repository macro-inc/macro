/**
 * The blocks that have a "Learn how to use" tutorial video. The id names the
 * block, keys its assets and messages, and is sent with analytics as
 * `macro-<id>`.
 */
export const TUTORIAL_IDS = [
  'mail',
  'home',
  'chat',
  'tasks',
  'docs',
  'drive',
  'crm',
  'calendar',
  'calls',
  'agents',
  'github',
  'scheduling',
  'whatsapp',
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
