/** Opaque versions of a provider-independent mailbox write. */
export interface MessageOperation {
  state:
    | 'PENDING'
    | 'SYNCHRONIZED'
    | 'CONFLICT'
    | 'UNCERTAIN'
    | 'SUBMITTING'
    | 'CONFIRMING'
    | 'SENT'
    | 'DELETED'
    | 'CANCELLED'
    | 'FAILED';
  revision: string;
  remoteVersion?: string | null;
  issue?:
    | 'ACCEPTING_REMOTE'
    | 'DRAFT_CONFLICT'
    | 'CREATION_UNKNOWN'
    | 'ATTACHMENT_UNKNOWN'
    | 'SEND_UNKNOWN'
    | 'SEND_REJECTED'
    | 'ACCESS_REVOKED'
    | 'INVALID_CONTENT'
    | 'MOVE_PENDING'
    | 'MOVE_CONFLICT'
    | 'MOVE_SOURCE_SENT'
    | 'MOVE_REAUTHORIZATION'
    | 'MOVE_ORIGINAL_REMAINS'
    | null;
}

export type MessageResolutionAction =
  | 'keep_local'
  | 'use_provider'
  | 'recheck'
  | 'retry_send'
  | 'keep_original';

/** Keep delivery and autosave paused while a provider outcome needs a decision. */
export function operationBlocksEditing(
  operation?: MessageOperation | null
): boolean {
  if (!operation || operation.issue?.startsWith('MOVE_')) return false;
  // Invalid draft content is safe to correct: no submission was attempted.
  if (operation.state === 'FAILED' && operation.issue === 'INVALID_CONTENT')
    return false;
  return (
    operation.issue === 'ACCEPTING_REMOTE' ||
    !['PENDING', 'SYNCHRONIZED'].includes(operation.state)
  );
}

export function operationActions(
  operation: MessageOperation
): MessageResolutionAction[] {
  if (operation.issue?.startsWith('MOVE_'))
    return operation.issue === 'MOVE_PENDING' ||
      operation.issue === 'MOVE_ORIGINAL_REMAINS'
      ? ['keep_original']
      : ['recheck', 'keep_original'];
  if (
    operation.state === 'CONFLICT' &&
    operation.issue === 'DRAFT_CONFLICT' &&
    operation.remoteVersion
  ) {
    return ['keep_local', 'use_provider'];
  }
  if (operation.state === 'UNCERTAIN') {
    return operation.issue === 'SEND_UNKNOWN'
      ? ['recheck', 'retry_send']
      : ['recheck'];
  }
  if (operation.state === 'FAILED' && operation.issue === 'SEND_REJECTED')
    return ['retry_send'];
  return [];
}

export function operationDescription(operation: MessageOperation): string {
  if (operation.issue === 'MOVE_PENDING')
    return 'Finishing the inbox change. You can edit this copy; sending waits until the original draft is resolved.';
  if (operation.issue === 'MOVE_CONFLICT')
    return 'The original draft changed in its mailbox. Keep that copy and continue here, or remove it in the original mailbox and check again.';
  if (operation.issue === 'MOVE_SOURCE_SENT')
    return 'The original copy was already sent. Sending this copy may deliver a duplicate.';
  if (operation.issue === 'MOVE_REAUTHORIZATION')
    return 'Reconnect the original inbox to finish moving this draft, or keep its original copy and continue here.';
  if (operation.issue === 'MOVE_ORIGINAL_REMAINS')
    return 'The original Gmail draft remains in its mailbox. Review it before continuing with this copy.';
  if (operation.issue === 'ACCEPTING_REMOTE')
    return 'Loading the mailbox version. Wait for synchronization before reopening the draft.';
  if (operation.issue === 'SEND_REJECTED')
    return 'Your mail provider rejected this send. You can retry after correcting the problem in your mailbox.';
  if (operation.issue === 'ACCESS_REVOKED')
    return 'Access to this inbox has changed. Reconnect it or ask its owner to restore your access.';
  if (operation.issue === 'INVALID_CONTENT')
    return 'Your mail provider could not save this draft. Edit the message or attachments to try again.';
  const descriptions: Record<MessageOperation['state'], string> = {
    PENDING: 'Synchronizing draft…',
    SYNCHRONIZED: 'Draft synchronized',
    CONFLICT:
      'This draft changed in your mailbox. Choose which version to keep. Either choice cancels scheduled delivery.',
    UNCERTAIN:
      operation.issue === 'SEND_UNKNOWN'
        ? 'Delivery could not be confirmed. Macro will not resend automatically. Check Sent mail or check again here.'
        : 'A draft or attachment write could not be confirmed. Your local copy is preserved; check again before making further changes.',
    SUBMITTING: 'Submitting email…',
    CONFIRMING: 'Confirming delivery…',
    SENT: 'Sent copy confirmed',
    DELETED: 'Draft deleted',
    CANCELLED: 'This operation was cancelled. Your local copy is preserved.',
    FAILED: 'This operation needs attention. Your local copy is preserved.',
  };
  return descriptions[operation.state];
}

/** A move may remain editable while the original copy still prevents delivery. */
export function operationBlocksSending(
  operation?: MessageOperation | null
): boolean {
  return (
    operationBlocksEditing(operation) || !!operation?.issue?.startsWith('MOVE_')
  );
}
