import {
  createPersistenceKey,
  type PersistenceKey,
} from '@queries/persistence';

type PersistenceProps = {
  channelId: string;
  threadId?: string;
};

const ATTACHMENT_TRACKER_PREFIX = 'attachment-tracker';
const ATTACHMENT_TRACKER_VERSION = 0;
const INPUT_VALUE_PREFIX = 'input-value';
const INPUT_VALUE_VERSION = 0;
const TASK_DRAFT_PREFIX = 'task-composer-draft';
const TASK_DRAFT_VERSION = 0;
const TASK_MODE_PREFIX = 'input-task-mode';
const TASK_MODE_VERSION = 0;

function makeScopedPersistenceName(prefix: string, props: PersistenceProps) {
  return `${prefix}-channel:${props.channelId}${props.threadId ? `-thread:${props.threadId}` : ''}`;
}

export function makeAttachmentTrackerPersistenceKey(
  props: PersistenceProps
): PersistenceKey {
  return createPersistenceKey(
    makeScopedPersistenceName(ATTACHMENT_TRACKER_PREFIX, props),
    ATTACHMENT_TRACKER_VERSION
  );
}

export function makeInputValuePersistenceKey(
  props: PersistenceProps
): PersistenceKey {
  return createPersistenceKey(
    makeScopedPersistenceName(INPUT_VALUE_PREFIX, props),
    INPUT_VALUE_VERSION
  );
}

export type InputTaskPersistence = {
  /** localStorage key for the task composer's draft blob. */
  draftKey: PersistenceKey;
  /** `makePersisted` key for the message/task mode flag. */
  modeKey: PersistenceKey;
};

/** Keys that persist a channel input's task draft and mode across visits. */
export function makeTaskPersistence(
  props: PersistenceProps
): InputTaskPersistence {
  return {
    draftKey: createPersistenceKey(
      makeScopedPersistenceName(TASK_DRAFT_PREFIX, props),
      TASK_DRAFT_VERSION
    ),
    modeKey: createPersistenceKey(
      makeScopedPersistenceName(TASK_MODE_PREFIX, props),
      TASK_MODE_VERSION
    ),
  };
}
