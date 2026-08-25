import {
  createPersistenceKey,
  type PersistenceKey,
} from '@queries/persistence';
import type { ChannelComposeMode } from '../compose-mode';

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
const EVENT_DRAFT_PREFIX = 'event-composer-draft';
const EVENT_DRAFT_VERSION = 0;
const COMPOSE_MODE_PREFIX = 'input-compose-mode';
const COMPOSE_MODE_VERSION = 0;
/** Pre-enum boolean task-mode flag, folded into the compose-mode key. */
const LEGACY_TASK_MODE_PREFIX = 'input-task-mode';
const LEGACY_TASK_MODE_VERSION = 0;

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

export type InputComposePersistence = {
  /** localStorage key for the task composer's draft blob. */
  taskDraftKey: PersistenceKey;
  /** localStorage key for the event composer's draft blob. */
  eventDraftKey: PersistenceKey;
  /** `makePersisted` key for the input's compose mode. */
  modeKey: PersistenceKey;
};

/**
 * Keys that persist a channel input's composer drafts and compose mode
 * across visits. Also folds the legacy boolean task-mode flag into the
 * compose-mode key the first time a channel's keys are built.
 */
export function makeComposePersistence(
  props: PersistenceProps
): InputComposePersistence {
  const modeKey = createPersistenceKey(
    makeScopedPersistenceName(COMPOSE_MODE_PREFIX, props),
    COMPOSE_MODE_VERSION
  );
  migrateLegacyTaskModeKey(props, modeKey);
  return {
    taskDraftKey: createPersistenceKey(
      makeScopedPersistenceName(TASK_DRAFT_PREFIX, props),
      TASK_DRAFT_VERSION
    ),
    eventDraftKey: createPersistenceKey(
      makeScopedPersistenceName(EVENT_DRAFT_PREFIX, props),
      EVENT_DRAFT_VERSION
    ),
    modeKey,
  };
}

/**
 * One-time migration: the compose mode used to be a per-channel boolean
 * (`input-task-mode`) written by `makePersisted`, so a stored `true` becomes
 * mode `task` unless a mode has already been written under the new key.
 */
function migrateLegacyTaskModeKey(
  props: PersistenceProps,
  modeKey: PersistenceKey
) {
  try {
    const legacyKey = createPersistenceKey(
      makeScopedPersistenceName(LEGACY_TASK_MODE_PREFIX, props),
      LEGACY_TASK_MODE_VERSION
    );
    const legacy = localStorage.getItem(legacyKey);
    if (legacy === null) return;
    localStorage.removeItem(legacyKey);
    if (legacy === 'true' && localStorage.getItem(modeKey) === null) {
      localStorage.setItem(
        modeKey,
        JSON.stringify('task' satisfies ChannelComposeMode)
      );
    }
  } catch {
    // localStorage unavailable; nothing to migrate.
  }
}
