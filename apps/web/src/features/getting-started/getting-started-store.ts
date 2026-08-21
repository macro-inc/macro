import { createUserScopedStorage } from '@core/util/userScopedStorage';

/** Persisted Getting Started progress. */
export type GettingStartedSnapshot = {
  /** Actions completed by clicking or by an observed event (not derived state). */
  completedActionIds: string[];
  collapsedSectionIds: string[];
};

/** Persistence seam for user-scoped Getting Started progress. */
export interface GettingStartedStore {
  load(userId: string): GettingStartedSnapshot | null;
  save(userId: string, snapshot: GettingStartedSnapshot): void;
}

const storage = createUserScopedStorage('macro:getting-started');

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

/**
 * Unknown ids are kept: they're inert at render time, and dropping them would
 * erase progress across config renames or a client running older config.
 */
export function parseGettingStartedSnapshot(
  raw: string | null
): GettingStartedSnapshot | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
      return null;
    const record = parsed as Record<string, unknown>;
    return {
      completedActionIds: stringArray(record.completedActionIds),
      collapsedSectionIds: stringArray(record.collapsedSectionIds),
    };
  } catch {
    return null;
  }
}

export const localStorageGettingStartedStore: GettingStartedStore = {
  load(userId) {
    return parseGettingStartedSnapshot(storage.read(userId));
  },
  save(userId, snapshot) {
    storage.write(userId, JSON.stringify(snapshot));
  },
};
