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
