import { useUserId } from '@core/context/user';
import {
  type EntityData,
  isTaskEntity,
  type TaskEntityWithProperties,
} from '@macro-entity';
import { makePersisted } from '@solid-primitives/storage';
import { createMemo, createSignal } from 'solid-js';
import { isSignalTask } from './Soup/utils/filterHelpers';
import type { ClientFilter } from './ViewConfig';

type SignalConfig<T extends string> = {
  key: T;
  label: string;
  defaultValue: boolean;
};

type SignalToggle<T extends string> = SignalConfig<T> & {
  enabled: () => boolean;
  setEnabled: (value: boolean) => void;
};

const makeToggle = (storageKey: string, defaultValue: boolean) =>
  makePersisted(createSignal(defaultValue), { name: storageKey });

const toStorageKey = (scope: string, key: string) =>
  `signalFilter_${scope}_${key.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;

const createSignalToggles = <T extends string>(
  scope: string,
  configs: SignalConfig<T>[]
): SignalToggle<T>[] =>
  configs.map((config) => {
    const [enabled, setEnabled] = makeToggle(
      toStorageKey(scope, config.key),
      config.defaultValue
    );
    return { ...config, enabled, setEnabled };
  });

const PRIORITY_LABEL_SIGNAL_CONFIGS: SignalConfig<string>[] = [
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
    label: 'Important',
    defaultValue: false,
  },
];

const DEPRIORITY_LABEL_SIGNAL_CONFIGS: SignalConfig<string>[] = [
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

export const PRIORITY_LABEL_SIGNAL_TOGGLES = createSignalToggles(
  'priority_label',
  PRIORITY_LABEL_SIGNAL_CONFIGS
);
export const DEPRIORITY_LABEL_SIGNAL_TOGGLES = createSignalToggles(
  'depriority_label',
  DEPRIORITY_LABEL_SIGNAL_CONFIGS
);

// Computed Sets based on persisted settings
const SIGNAL_PRIORITY_LABELS = createMemo(
  () =>
    new Set(
      PRIORITY_LABEL_SIGNAL_TOGGLES.filter(({ enabled }) => enabled()).map(
        ({ key }) => key
      )
    )
);

const SIGNAL_DEPRIORITY_LABELS = createMemo(
  () =>
    new Set(
      DEPRIORITY_LABEL_SIGNAL_TOGGLES.filter(({ enabled }) => enabled()).map(
        ({ key }) => key
      )
    )
);

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

const getEmailSignalInfo = (entity: Extract<EntityData, { type: 'email' }>) => {
  const labelTokens = getLabelTokens(entity.labels);
  const priorityLabels = SIGNAL_PRIORITY_LABELS();
  const depriorityLabels = SIGNAL_DEPRIORITY_LABELS();

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
};

const isSignalEmail = (entity: Extract<EntityData, { type: 'email' }>) => {
  const { hasPriority, hasDepriority } = getEmailSignalInfo(entity);
  // Signal = has priority indicators OR has no depriority indicators
  return hasPriority || !hasDepriority;
};

const isNoiseEmail = (entity: Extract<EntityData, { type: 'email' }>) => {
  const { hasPriority, hasDepriority } = getEmailSignalInfo(entity);
  // Noise = has depriority indicators AND no priority indicators
  return hasDepriority && !hasPriority;
};

const hasRecentlyViewed = (entity: EntityData) => {
  if (!entity.viewedAt) return false;

  const now = Date.now();
  const viewedAt = new Date(entity.viewedAt);

  const diff = now - viewedAt.getTime();

  const seconds = diff / 1000;

  const oneDayOfSeconds = 3600 * 24;

  return seconds < oneDayOfSeconds;
};

const getCurrentUserId = () => {
  try {
    return useUserId()();
  } catch {
    return undefined;
  }
};

export const signalFilter: ClientFilter = {
  id: 'signal',
  predicate: (entity, _ctx) => {
    switch (entity.type) {
      case 'channel': {
        return true;
      }
      case 'chat': {
        return hasRecentlyViewed(entity);
      }
      case 'document': {
        if (isTaskEntity(entity)) {
          const currentUserId = getCurrentUserId();
          return isSignalTask(
            entity as TaskEntityWithProperties,
            currentUserId
          );
        }
        return hasRecentlyViewed(entity);
      }
      case 'email': {
        return isSignalEmail(entity) || entity.isDraft;
      }
      case 'project': {
        return hasRecentlyViewed(entity);
      }
    }
  },
};

export const noiseFilter: ClientFilter = {
  id: 'noise',
  predicate: (entity, ctx) => {
    return !signalFilter.predicate(entity, ctx);
  },
};

/**
 * Explicit noise filter - only returns true for items with explicit noise indicators.
 * Currently only emails can be "explicit noise" (those with depriority labels/metadata).
 * Non-email items are never considered explicit noise (they're neutral).
 */
export const explicitNoiseFilter: ClientFilter = {
  id: 'explicitNoise',
  predicate: (entity, _ctx) => {
    if (entity.type === 'email') {
      return isNoiseEmail(entity);
    }
    // Non-email items are never explicit noise
    return false;
  },
};
