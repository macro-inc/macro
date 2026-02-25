import {
  isCurrentUserAssigned,
  isTaskClosed,
  isTaskEntity,
  type TaskEntityWithProperties,
  type EntityData,
} from '@entity';
import { useUserId } from '@core/context/user';
import { createMemo } from 'solid-js';
import {
  DEPRIORITY_LABEL_SIGNAL_TOGGLES,
  PRIORITY_LABEL_SIGNAL_TOGGLES,
} from '@app/component/next-soup/filters/signal-configs';

/** Labels that indicate priority emails (signal) */
const PRIORITY_LABELS = createMemo(
  () =>
    new Set(
      PRIORITY_LABEL_SIGNAL_TOGGLES.filter(({ enabled }) => enabled()).map(
        ({ key }) => key
      )
    )
);

/** Labels that indicate depriority emails (noise) */
const DEPRIORITY_LABELS = createMemo(
  () =>
    new Set(
      DEPRIORITY_LABEL_SIGNAL_TOGGLES.filter(({ enabled }) => enabled()).map(
        ({ key }) => key
      )
    )
);

// ============================================================================
// Signal/Noise Configuration
// ============================================================================

/** Extract label tokens from email labels for matching */
const getLabelTokens = (
  labels?: Array<{ id?: string; providerLabelId?: string; name?: string }>
): string[] => {
  if (!labels?.length) return [];

  const tokens: string[] = [];
  for (const label of labels) {
    if (label.id) tokens.push(label.id);
    if (label.providerLabelId) tokens.push(label.providerLabelId);
    if (label.name) tokens.push(label.name);
  }

  return tokens.map((token) => token.toUpperCase());
};

type EmailEntity = Extract<EntityData, { type: 'email' }>;

/** Analyze email for priority/depriority indicators */
function getEmailSignalInfo(entity: EmailEntity): {
  hasPriority: boolean;
  hasDepriority: boolean;
} {
  const labelTokens = getLabelTokens(entity.labels);
  const priorityLabels = PRIORITY_LABELS();
  const depriorityLabels = DEPRIORITY_LABELS();

  const hasPriorityLabel = labelTokens.some((label) =>
    priorityLabels.has(label)
  );
  const hasDeprioritizingLabel = labelTokens.some((label) =>
    depriorityLabels.has(label)
  );

  return {
    hasPriority: hasPriorityLabel,
    hasDepriority: hasDeprioritizingLabel,
  };
}

/** Check if email is signal (important) */
function isSignalEmail(entity: EmailEntity): boolean {
  const { hasPriority, hasDepriority } = getEmailSignalInfo(entity);
  // Signal = has priority indicators OR no depriority indicators
  return hasPriority || !hasDepriority;
}

/** Check if email is noise (less important) */
function isNoiseEmail(entity: EmailEntity): boolean {
  const { hasPriority, hasDepriority } = getEmailSignalInfo(entity);
  // Noise = has depriority indicators AND no priority indicators
  return hasDepriority && !hasPriority;
}

/**
 * determines if a task should appear in the signal tab.
 * tasks appear in signal if:
 * - they are not completed or canceled
 * - the current user is an assignee (or the task has no assignees)
 */
export const isSignalTask = (
  entity: TaskEntityWithProperties,
  currentUserId: string | undefined
): boolean => {
  if (isTaskClosed(entity)) {
    return false;
  }
  return isCurrentUserAssigned(entity, currentUserId);
};

const getCurrentUserId = () => {
  try {
    return useUserId()();
  } catch {
    return undefined;
  }
};

/**
 * Signal filter - important/prioritized items.
 *
 * Classification:
 * - Channels: Always signal (explicit membership)
 * - Chats: Always signal
 * - Documents: Docs always signal, tasks depending on conditions
 * - Emails: Based on priority/depriority labels and metadata
 * - Projects: Always signal
 */
export function signalFilter(entity: EntityData): boolean {
  switch (entity.type) {
    case 'channel':
      return true;
    case 'chat':
      return true;
    case 'document': {
      if (isTaskEntity(entity)) {
        const currentUserId = getCurrentUserId();
        return isSignalTask(entity as TaskEntityWithProperties, currentUserId);
      }

      return true;
    }
    case 'email':
      return isSignalEmail(entity) || entity.isDraft;
    case 'project':
      return true;
  }
}

/**
 * Noise filter - less important items.
 * Returns the opposite of signal filter.
 */
export function noiseFilter(entity: EntityData): boolean {
  return !signalFilter(entity);
}

/**
 * Explicit noise filter - only true for items with explicit noise indicators.
 *
 * Currently only emails can be "explicit noise" (those with depriority labels/metadata).
 * Non-email items are never considered explicit noise (they're neutral).
 *
 * This is used when NO focus filter is selected to hide explicitly noisy items.
 */
export function explicitNoiseFilter(entity: EntityData): boolean {
  if (entity.type === 'email') {
    return isNoiseEmail(entity);
  }
  // Non-email items are never explicit noise
  return false;
}
