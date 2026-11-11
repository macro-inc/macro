import { z } from 'zod';
import { frontendInstanceId } from './frontend-instance';

const KEY = 'macro-document-lifecycle';
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const navigationSchema = z.object({
  commits: count,
  paneCount: count,
  historyEntryCount: count,
  savedEntryStateCount: count,
});
type NavigationSnapshot = Omit<z.infer<typeof navigationSchema>, 'commits'>;
const checkpointSchema = z.object({
  frontendInstanceId: z.uuid(),
  startedAtMs: z.number().int().nonnegative(),
  updatedAtMs: z.number().int().nonnegative(),
  visible: z.boolean(),
  navigation: navigationSchema.optional(),
  pagehide: z
    .object({ atMs: z.number().int().nonnegative(), persisted: z.boolean() })
    .optional(),
});

// Document-owned diagnostics only; no account, URL, or content state.
let stopCurrent: (() => void) | undefined;
let recordNavigation: ((snapshot: NavigationSnapshot) => void) | undefined;

/** Counts only: never pass routes, entry ids, or captured view state. */
export function recordDocumentNavigation(snapshot: NavigationSnapshot): void {
  recordNavigation?.(snapshot);
}

function readCheckpoint() {
  try {
    const parsed = checkpointSchema.safeParse(
      JSON.parse(sessionStorage.getItem(KEY) ?? 'null')
    );
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** Runs on old binaries too. No timers, native IPC, or unload-time network export. */
export function startDocumentLifecycle() {
  stopCurrent?.();
  const now = Date.now();
  const saved = readCheckpoint();
  let previous =
    saved &&
    saved.frontendInstanceId !== frontendInstanceId &&
    saved.startedAtMs <= saved.updatedAtMs &&
    saved.updatedAtMs <= now &&
    (!saved.pagehide ||
      (saved.pagehide.atMs >= saved.startedAtMs &&
        saved.pagehide.atMs <= saved.updatedAtMs)) &&
    now - saved.updatedAtMs <= 24 * 60 * 60_000
      ? saved
      : undefined;
  const checkpoint: z.infer<typeof checkpointSchema> = {
    frontendInstanceId,
    startedAtMs: now,
    updatedAtMs: now,
    visible: document.visibilityState === 'visible',
  };
  let active = true;
  const write = () => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(checkpoint));
    } catch {
      // Storage restrictions must not affect the app.
    }
  };
  const update = () => {
    // Logout or a replacement document revokes this document's ownership.
    if (!active || readCheckpoint()?.frontendInstanceId !== frontendInstanceId)
      return;
    checkpoint.updatedAtMs = Date.now();
    checkpoint.visible = document.visibilityState === 'visible';
    write();
  };
  const hide = (event: PageTransitionEvent) => {
    checkpoint.pagehide = { atMs: Date.now(), persisted: event.persisted };
    update();
  };
  const show = (event: PageTransitionEvent) => {
    if (!active || !event.persisted) return;
    if (readCheckpoint()?.frontendInstanceId !== frontendInstanceId) {
      // A cached document resumed after another document/account owned the
      // checkpoint. Report unknown next time rather than attributing its exit
      // to that other document or reclaiming the old identity.
      clearDocumentLifecycle();
      return;
    }
    checkpoint.pagehide = undefined;
    update();
  };
  const navigation = (snapshot: NavigationSnapshot) => {
    checkpoint.navigation = {
      commits: Math.min(
        (checkpoint.navigation?.commits ?? 0) + 1,
        Number.MAX_SAFE_INTEGER
      ),
      paneCount: snapshot.paneCount,
      historyEntryCount: snapshot.historyEntryCount,
      savedEntryStateCount: snapshot.savedEntryStateCount,
    };
    update();
  };
  recordNavigation = navigation;
  write();
  document.addEventListener('visibilitychange', update);
  window.addEventListener('pagehide', hide);
  window.addEventListener('pageshow', show);
  const dispose = () => {
    active = false;
    previous = undefined;
    if (recordNavigation === navigation) recordNavigation = undefined;
    document.removeEventListener('visibilitychange', update);
    window.removeEventListener('pagehide', hide);
    window.removeEventListener('pageshow', show);
  };
  stopCurrent = dispose;

  return {
    dispose,
    get attributes() {
      return {
        previous_document_checkpoint_available: previous !== undefined,
        previous_document_instance_id: previous?.frontendInstanceId,
        previous_document_started_at_ms: previous?.startedAtMs,
        previous_document_checkpoint_at_ms: previous?.updatedAtMs,
        previous_document_visible: previous?.visible,
        previous_document_pagehide_observed: previous
          ? previous.pagehide !== undefined
          : undefined,
        previous_document_pagehide_at_ms: previous?.pagehide?.atMs,
        previous_document_pagehide_persisted: previous?.pagehide?.persisted,
        previous_document_navigation_commits: previous?.navigation?.commits,
        previous_document_pane_count: previous?.navigation?.paneCount,
        previous_document_history_entry_count:
          previous?.navigation?.historyEntryCount,
        previous_document_saved_entry_state_count:
          previous?.navigation?.savedEntryStateCount,
      };
    },
  };
}

/** Prevent a late lifecycle callback from relinking a signed-out document. */
export function clearDocumentLifecycle(): void {
  stopCurrent?.();
  stopCurrent = undefined;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Best effort, matching the native diagnostic lease.
  }
}
