import { ENABLE_CLIENT_EMAIL_SIGNAL_FILTER } from '@core/constant/featureFlags';
import type { EntityData } from '@entity';

const PRIORITY_LABELS = [
  {
    key: 'CATEGORY_PERSONAL',
    label: 'Personal',
    defaultValue: true,
  },
  {
    key: 'SENT',
    label: 'Sent',
    defaultValue: true,
  },
  {
    key: 'IMPORTANT',
    label: 'Signal',
    defaultValue: false,
  },
];

const DEPRIORITY_LABELS = [
  {
    key: 'CATEGORY_UPDATES',
    label: 'Updates',
    defaultValue: true,
  },
  {
    key: 'CATEGORY_PROMOTIONS',
    label: 'Promotions',
    defaultValue: true,
  },
  {
    key: 'CATEGORY_SOCIAL',
    label: 'Social',
    defaultValue: true,
  },
  {
    key: 'CATEGORY_FORUMS',
    label: 'Forums',
    defaultValue: true,
  },
];

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

function getEmailSignalInfo(entity: EmailEntity): {
  hasPriority: boolean;
  hasDepriority: boolean;
} {
  const labelTokens = getLabelTokens(entity.labels);
  const priorityLabels = PRIORITY_LABELS;
  const depriorityLabels = DEPRIORITY_LABELS;

  const hasPriorityLabel = priorityLabels.some((label) =>
    labelTokens.includes(label.key)
  );
  const hasDeprioritizingLabel = depriorityLabels.some((label) =>
    labelTokens.includes(label.key)
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
 * Signal filter - important/prioritized items.
 *
 * The inbox query already gates entities on the user's not-done notifications,
 * so non-email types are signal whenever they're returned. Email priority is
 * still classified client-side from labels.
 */
export function signalFilter(entity: EntityData): boolean {
  switch (entity.type) {
    case 'channel':
      return true;
    case 'chat':
      return true;
    case 'document':
      return true;
    case 'email':
      if (!ENABLE_CLIENT_EMAIL_SIGNAL_FILTER) return true;
      return isSignalEmail(entity) || entity.isDraft;
    case 'project':
      return true;
    case 'channel_message':
      return true;
    case 'call':
      return true;
    case 'automation':
      // Automations only show in the Agents > Scheduled tab, not Inbox.
      return false;
    case 'foreign':
      return false;
  }
}

/**
 * Noise filter - less important items.
 * Returns the opposite of signal filter.
 */
export function noiseFilter(entity: EntityData): boolean {
  if (entity.type === 'email' && !ENABLE_CLIENT_EMAIL_SIGNAL_FILTER)
    return true;
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
    if (!ENABLE_CLIENT_EMAIL_SIGNAL_FILTER) return false;
    return isNoiseEmail(entity);
  }
  // Non-email items are never explicit noise
  return false;
}
