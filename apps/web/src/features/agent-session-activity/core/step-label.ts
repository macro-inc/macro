import type { TranslationKey } from '@app/lib/i18n';

/**
 * The message for an activity step's verb: an SDK verb (`edited`) or, for
 * rows written without one, the stored action tag (`property_changed`). Every
 * verb the SDK can send has a message; anything unknown reads as "Changed",
 * never as a raw tag.
 */
const STEP_LABELS: Record<string, TranslationKey> = {
  access_requested: 'agentWork.stepAccessRequested',
  added: 'agentWork.stepAdded',
  approved: 'agentWork.stepApproved',
  archived: 'agentWork.stepArchived',
  blocked: 'agentWork.stepBlocked',
  call_ended: 'agentWork.stepCallEnded',
  call_started: 'agentWork.stepCallStarted',
  cancelled: 'agentWork.stepCancelled',
  confirmed: 'agentWork.stepConfirmed',
  copied: 'agentWork.stepCopied',
  created: 'agentWork.stepCreated',
  deleted: 'agentWork.stepDeleted',
  disabled: 'agentWork.stepDisabled',
  edited: 'agentWork.stepEdited',
  enabled: 'agentWork.stepEnabled',
  generated: 'agentWork.stepGenerated',
  imported: 'agentWork.stepImported',
  invited: 'agentWork.stepInvited',
  joined: 'agentWork.stepJoined',
  labeled: 'agentWork.stepLabeled',
  left: 'agentWork.stepLeft',
  linked: 'agentWork.stepLinked',
  marked: 'agentWork.stepMarked',
  messaged: 'agentWork.stepMessaged',
  moved: 'agentWork.stepMoved',
  participant_added: 'agentWork.stepParticipantAdded',
  participant_removed: 'agentWork.stepParticipantRemoved',
  picture_changed: 'agentWork.stepPictureChanged',
  posted: 'agentWork.stepPosted',
  property_changed: 'agentWork.stepPropertyChanged',
  ran: 'agentWork.stepRan',
  reacted: 'agentWork.stepReacted',
  registered: 'agentWork.stepRegistered',
  rejected: 'agentWork.stepRejected',
  removed: 'agentWork.stepRemoved',
  renamed: 'agentWork.stepRenamed',
  reordered: 'agentWork.stepReordered',
  requested: 'agentWork.stepRequested',
  responded: 'agentWork.stepResponded',
  restored: 'agentWork.stepRestored',
  scheduled: 'agentWork.stepScheduled',
  sent: 'agentWork.stepSent',
  shared: 'agentWork.stepShared',
  stopped: 'agentWork.stepStopped',
  submitted: 'agentWork.stepSubmitted',
  task_added: 'agentWork.stepTaskAdded',
  task_removed: 'agentWork.stepTaskRemoved',
  unblocked: 'agentWork.stepUnblocked',
  unlinked: 'agentWork.stepUnlinked',
  unshared: 'agentWork.stepUnshared',
  uploaded: 'agentWork.stepUploaded',
};

export function stepLabelKey(verb: string): TranslationKey {
  return STEP_LABELS[verb] ?? 'agentWork.stepChanged';
}
