import { globalSplitManager } from '@app/signal/splitLayout';
import type { SplitContent } from '@components/app/split-layout/layoutManager';

const sessionContent = (sessionId: string): SplitContent => ({
  type: 'agent',
  id: sessionId,
});

/**
 * Opens the agent chat that ran an import and moves focus into it. A chat
 * that was already open keeps its pane, which does not focus itself again.
 */
export function openImportSession(sessionId: string): void {
  const manager = globalSplitManager();
  if (!manager) return;
  manager.openWithSplit(sessionContent(sessionId), { activate: true });
  manager.returnFocus();
}

/** Whether the active split already shows the chat that ran an import. */
export function isImportSessionActive(sessionId: string): boolean {
  const manager = globalSplitManager();
  if (!manager) return false;
  const view = manager.findOpenView(sessionContent(sessionId));
  return view !== undefined && view.owner === manager.activeSplitId();
}
