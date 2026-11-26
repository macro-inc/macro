import { createUserScopedStorage } from '@core/util/userScopedStorage';
import type { ImportRun } from '@service-cognition/import';
import { z } from 'zod';
import { importJobKey } from './core/import-job';

/**
 * The import runs a user dismissed, kept on this device so a reload keeps
 * them hidden. Shared by the imports tray and the review card, whose Dismiss
 * also dismisses the run's tray entry.
 */
const STORAGE = createUserScopedStorage('import-jobs:dismissed:v1');

/** Fired on this page when a dismissal is recorded outside the tray. */
const CHANGED = 'macro:import-jobs-dismissed';

// Kept small: the newest dismissals win when there are too many.
const DISMISSED = z.array(z.string()).transform((keys) => keys.slice(-64));

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function readDismissedRuns(userId: string): string[] {
  const raw = STORAGE.read(userId);
  if (raw === null) return [];
  const parsed = DISMISSED.safeParse(safeJson(raw));
  return parsed.success ? parsed.data : [];
}

export function writeDismissedRuns(userId: string, keys: readonly string[]) {
  STORAGE.write(userId, JSON.stringify(keys.slice(-64)));
}

/** Dismiss `run`'s tray entry from elsewhere (the review card). */
export function dismissImportRun(userId: string, run: ImportRun) {
  const key = importJobKey(run);
  const current = readDismissedRuns(userId);
  if (current.includes(key)) return;
  writeDismissedRuns(userId, [...current, key]);
  window.dispatchEvent(new Event(CHANGED));
}

/** Calls `onChange` when a dismissal is recorded outside the tray. */
export function onDismissedRunsChange(onChange: () => void): () => void {
  window.addEventListener(CHANGED, onChange);
  return () => window.removeEventListener(CHANGED, onChange);
}
