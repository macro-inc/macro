export type RoutineRow = {
  id: string;
  name: string;
  createdAt: string;
  /** What starts it, e.g. "When: New email received". */
  when: string;
  /** What it does in a line, e.g. "Label with AI · 2 more". */
  does: string;
  /** Activity routines run on events; the rest on a schedule. */
  group: 'activity' | 'schedule';
  /** Its latest run in a line, when it has run. */
  lastRun?: { at: string; failed: boolean; summary: string };
  status: 'Active' | 'Paused' | 'Running' | 'Completed';
  editable: boolean;
  enabled: boolean;
};
