import { globalSplitManager } from '@app/signal/splitLayout';
import type { SplitContent } from '@components/app/split-layout/layoutManager';
import { isTouchDevice } from '@core/mobile/isTouchDevice';

const sessionContent = (sessionId: string): SplitContent => ({
  type: 'agent',
  id: sessionId,
});

/**
 * Opens the agent chat that ran an import and moves focus into it. A chat
 * that was already open keeps its pane, which does not focus itself again.
 * Not on touch, where focusing the chat's composer would raise the keyboard.
 */
export function openImportSession(sessionId: string): void {
  const manager = globalSplitManager();
  if (!manager) return;
  manager.openWithSplit(sessionContent(sessionId), { activate: true });
  if (!isTouchDevice()) manager.returnFocus();
}

/** Whether the active split already shows the chat that ran an import. */
export function isImportSessionActive(sessionId: string): boolean {
  const manager = globalSplitManager();
  if (!manager) return false;
  const view = manager.findOpenView(sessionContent(sessionId));
  // An inline preview is owned by itself but shown in a split.
  return (
    view !== undefined && (view.split ?? view.owner) === manager.activeSplitId()
  );
}
