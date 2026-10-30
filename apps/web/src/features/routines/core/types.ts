import type { WorkChip } from './routine-summary';
import type { TriggerKind } from './routine-triggers';
import type { RunOutcome } from './step-history';

export type RoutineRow = {
  id: string;
  name: string;
  createdAt: string;
  /** What starts it, e.g. "New email received" or "Weekdays at 9:00 AM". */
  when: string;
  /** What kind of thing starts it, for the icon beside `when`. */
  whenKind?: TriggerKind;
  /** What it does in a line, e.g. "Invoice, Newsletter · 4 actions". */
  does: string;
  /** How AI takes part, shown as a chip before `does`. */
  ai?: WorkChip;
  /** Activity routines run on events; the rest on a schedule. */
  group: 'activity' | 'schedule';
  /** Its latest run in a line, when it has run. */
  lastRun?: { at: string; outcome: RunOutcome; summary: string };
  status: 'Active' | 'Paused' | 'Running' | 'Completed';
  editable: boolean;
  enabled: boolean;
};
