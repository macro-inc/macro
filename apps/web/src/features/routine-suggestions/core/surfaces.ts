/**
 * The view sidebars that show routine suggestions. Each surface names the
 * part of Macro its suggestions automate; the server generates suggestions
 * for these same keys (`RoutineSurface` in the `routine_suggestions` crate).
 */
export const routineSurfaces = [
  'email',
  'calendar',
  'tasks',
  'files',
  'crm',
  'chat',
  'calls',
  'reviews',
  'agents',
] as const;

export type RoutineSurface = (typeof routineSurfaces)[number];

export type RoutineSurfaceCopy = {
  /** Names the surface in the modal title and filter chips. */
  label: string;
  /** Heads the surface's group where suggestions of every surface are listed. */
  groupLabel: string;
  /** The sidebar card's one-line pitch. */
  pitch: string;
};

export const routineSurfaceCopy: Record<RoutineSurface, RoutineSurfaceCopy> = {
  email: {
    label: 'Email',
    groupLabel: 'Email automations',
    pitch: 'Let AI triage, tag, and follow up on your mail',
  },
  calendar: {
    label: 'Calendar',
    groupLabel: 'Calendar automations',
    pitch: 'Prep for meetings before they start',
  },
  tasks: {
    label: 'Tasks',
    groupLabel: 'Task automations',
    pitch: 'Keep tasks moving without the busywork',
  },
  files: {
    label: 'Files',
    groupLabel: 'Document automations',
    pitch: 'Keep your documents organized and current',
  },
  crm: {
    label: 'CRM',
    groupLabel: 'CRM automations',
    pitch: 'Keep every company and deal in the right place',
  },
  chat: {
    label: 'Chat',
    groupLabel: 'Chat automations',
    pitch: 'Never miss what matters in your channels',
  },
  calls: {
    label: 'Calls',
    groupLabel: 'Call automations',
    pitch: 'Turn every call into next steps',
  },
  reviews: {
    label: 'Reviews',
    groupLabel: 'Code review automations',
    pitch: 'Stay on top of pull requests',
  },
  agents: {
    label: 'Agents',
    groupLabel: 'Workspace automations',
    pitch: 'Put your recurring work on autopilot',
  },
};
