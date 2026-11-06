import { confirmDialog } from '@ui';

/**
 * The one confirmation for letting a runtime's agents skip permission
 * requests, asked wherever bypass is turned on: the runtime's switch in
 * Settings, or a session's permission request. `alsoSetsAgent` adds that the
 * asking agent is set to bypass too.
 */
export function confirmPermissionBypass(options?: {
  alsoSetsAgent?: boolean;
}): Promise<boolean> {
  const body =
    'Agents set to bypass can run commands and edit files on this machine without approval. Only enable this if you trust everyone who can create agents on this runtime.';
  return confirmDialog({
    title: 'Allow bypassing permission requests?',
    body: options?.alsoSetsAgent
      ? `${body} This agent will also be set to Always bypass.`
      : body,
    confirmLabel: 'Allow',
    tone: 'danger',
  });
}
