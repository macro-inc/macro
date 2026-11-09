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

type SurfaceCopy = {
  /** Names the surface in the dialog title and filter chips. */
  label: string;
  /** The sidebar card's line before a suggestion has loaded. */
  pitch: string;
};

/** Sidebar promotions aren't translated yet; this copy matches them. */
export const SURFACE_COPY: Record<RoutineSurface, SurfaceCopy> = {
  email: {
    label: 'Email',
    pitch: 'Let AI triage, tag, and follow up on your mail',
  },
  calendar: { label: 'Calendar', pitch: 'Prep for meetings before they start' },
  tasks: { label: 'Tasks', pitch: 'Keep tasks moving without the busywork' },
  files: { label: 'Files', pitch: 'Keep your documents organized and current' },
  crm: {
    label: 'CRM',
    pitch: 'Keep every company and deal in the right place',
  },
  chat: { label: 'Chat', pitch: 'Never miss what matters in your channels' },
  calls: { label: 'Calls', pitch: 'Turn every call into next steps' },
  reviews: { label: 'Reviews', pitch: 'Stay on top of pull requests' },
  agents: { label: 'Agents', pitch: 'Put your recurring work on autopilot' },
};
