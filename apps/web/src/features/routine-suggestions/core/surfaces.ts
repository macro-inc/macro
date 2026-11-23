import type { TranslationKey } from '@app/lib/i18n';
import type { Surface } from '@service-scheduled-action/generated/schemas';

/**
 * Where suggestions show: the sidebar of each part of the app, in the
 * scheduler's catalog surfaces (`routine_program::Surface`).
 */
export type RoutineSurface = Surface;

export const ROUTINE_SURFACES: readonly RoutineSurface[] = [
  'email',
  'calendar',
  'tasks',
  'files',
  'crm',
  'chat',
  'calls',
  'reviews',
  'agents',
];

/** Each surface's name, as a translation key. */
export const SURFACE_LABEL_KEYS = {
  email: 'routineSuggestions.surfaceEmail',
  calendar: 'routineSuggestions.surfaceCalendar',
  tasks: 'routineSuggestions.surfaceTasks',
  files: 'routineSuggestions.surfaceFiles',
  crm: 'routineSuggestions.surfaceCrm',
  chat: 'routineSuggestions.surfaceChat',
  calls: 'routineSuggestions.surfaceCalls',
  reviews: 'routineSuggestions.surfaceReviews',
  agents: 'routineSuggestions.surfaceAgents',
} as const satisfies Record<RoutineSurface, TranslationKey>;
